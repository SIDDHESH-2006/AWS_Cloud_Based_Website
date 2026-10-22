#!/usr/bin/env python3
"""
Full-Featured AWS Cloud Control Plane & Terminal Execution Engine
-------------------------------------------------------------------
- Live AWS Authentication & Session Management (Browser SSO login / Access Keys / Status)
- Direct AWS Terminal Command Runner (Run any commands from commands.sh right in the UI)
- S3 Bucket Provisioning, Sync, and File Management
- CloudWatch Synthetics URL Probes & Metric Publication
- CloudWatch Metric Alarms & CloudFront Invalidation
- Dual Mode: Real AWS when authenticated, local fallback when unauthenticated.
"""

import base64
import hashlib
import http.client
import json
import mimetypes
import os
import re
import socket
import ssl
import subprocess
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = (BASE_DIR / "..").resolve()
S3_STORAGE_DIR = BASE_DIR / "s3_storage"
STATE_FILE = BASE_DIR / "cloud_state.json"
DIST_DIR = (PROJECT_DIR / "frontend/dist").resolve()

S3_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_REGION = os.environ.get("AWS_REGION", "ap-south-1")
DEFAULT_BUCKET_NAME = os.environ.get("AWS_BUCKET", "cloudpulse-frontend-live-bucket")
ACTIVE_SSO_PROC = None


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def check_aws_auth():
    """Checks real AWS connection via sts get-caller-identity."""
    try:
        session = boto3.Session(region_name=DEFAULT_REGION)
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        return {
            "authenticated": True,
            "account": identity.get("Account"),
            "arn": identity.get("Arn"),
            "userId": identity.get("UserId"),
            "region": DEFAULT_REGION,
            "boto3Available": True
        }
    except Exception as e:
        return {
            "authenticated": False,
            "error": str(e),
            "region": DEFAULT_REGION,
            "boto3Available": BOTO3_AVAILABLE
        }


def get_aws_clients():
    if not BOTO3_AVAILABLE:
        return None, None, None, None
    try:
        session = boto3.Session(region_name=DEFAULT_REGION)
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        s3 = session.client("s3")
        cloudwatch = session.client("cloudwatch")
        cloudfront = session.client("cloudfront")
        return s3, cloudwatch, cloudfront, identity
    except Exception:
        return None, None, None, None


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "probes": [],
        "alarms": [],
        "invalidations": [],
        "commandHistory": [],
        "logs": []
    }


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def append_log(state: dict, service: str, level: str, message: str):
    entry = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": utc_now(),
        "service": service,
        "level": level,
        "message": message
    }
    state["logs"].insert(0, entry)
    state["logs"] = state["logs"][:150]


def list_s3_objects(s3_client=None, bucket_name=DEFAULT_BUCKET_NAME) -> list:
    if s3_client:
        try:
            resp = s3_client.list_objects_v2(Bucket=bucket_name)
            objects = []
            for item in resp.get("Contents", []):
                key = item["Key"]
                ctype, _ = mimetypes.guess_type(key)
                objects.append({
                    "key": key,
                    "sizeBytes": item["Size"],
                    "mimeType": ctype or "application/octet-stream",
                    "etag": item["ETag"],
                    "lastModified": item["LastModified"].strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "storageClass": item.get("StorageClass", "STANDARD"),
                    "source": f"AWS S3 Cloud (s3://{bucket_name})"
                })
            return objects
        except Exception:
            pass

    objects = []
    for f in sorted(S3_STORAGE_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            raw = f.read_bytes()
            etag = hashlib.md5(raw).hexdigest()
            ctype, _ = mimetypes.guess_type(str(f))
            stat = f.stat()
            objects.append({
                "key": f.name,
                "sizeBytes": stat.st_size,
                "mimeType": ctype or "application/octet-stream",
                "etag": f'"{etag}"',
                "lastModified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                "storageClass": "STANDARD",
                "source": "Local S3 Storage"
            })
    return objects


def list_real_s3_buckets(s3_client=None) -> list:
    if not s3_client:
        return []
    try:
        resp = s3_client.list_buckets()
        return [b["Name"] for b in resp.get("Buckets", [])]
    except Exception:
        return []


def list_real_cloudfront_distributions(cf_client=None) -> list:
    if not cf_client:
        return []
    try:
        resp = cf_client.list_distributions()
        items = resp.get("DistributionList", {}).get("Items", [])
        return [
            {
                "id": d["Id"],
                "domain": d["DomainName"],
                "status": d["Status"],
                "enabled": d["Enabled"]
            }
            for d in items
        ]
    except Exception:
        return []


def publish_cloudwatch_metric(cw_client, metric_name: str, value: float, unit: str = "Milliseconds"):
    if not cw_client:
        return False, "Not connected"
    try:
        cw_client.put_metric_data(
            Namespace="CloudPulse",
            MetricData=[
                {
                    "MetricName": metric_name,
                    "Value": float(value),
                    "Unit": unit,
                    "Timestamp": datetime.now(timezone.utc)
                }
            ]
        )
        return True, "Published to AWS CloudWatch"
    except Exception as e:
        return False, str(e)


def sync_cloudwatch_alarm(cw_client, alarm: dict):
    if not cw_client:
        return False, "Not connected"
    try:
        op_map = {
            ">": "GreaterThanThreshold",
            ">=": "GreaterThanOrEqualToThreshold",
            "<": "LessThanThreshold",
            "<=": "LessThanOrEqualToThreshold",
            "==": "GreaterThanOrEqualToThreshold"
        }
        cw_client.put_metric_alarm(
            AlarmName=f"CloudPulse-{alarm['name']}",
            ComparisonOperator=op_map.get(alarm["operator"], "GreaterThanThreshold"),
            EvaluationPeriods=1,
            MetricName=alarm["metric"],
            Namespace="CloudPulse",
            Period=60,
            Statistic="Average",
            Threshold=float(alarm["threshold"]),
            ActionsEnabled=False,
            AlarmDescription="CloudPulse Web Console Automated Alarm"
        )
        return True, "Synced to AWS CloudWatch Alarms"
    except Exception as e:
        return False, str(e)


def evaluate_alarms(state: dict):
    probes = state["probes"]
    s3_objects = list_s3_objects()
    total_s3_bytes = sum(o["sizeBytes"] for o in s3_objects)
    latest_probe = probes[0] if probes else None

    for alarm in state["alarms"]:
        metric = alarm["metric"]
        operator = alarm["operator"]
        threshold = float(alarm["threshold"])

        current_val = None
        if metric in ("TotalLatencyMs", "DnsLookupMs", "TcpConnectMs", "TlsHandshakeMs", "TtfbMs", "HttpStatusCode"):
            if latest_probe:
                mapping = {
                    "TotalLatencyMs": latest_probe.get("totalMs", 0),
                    "DnsLookupMs": latest_probe.get("dnsMs", 0),
                    "TcpConnectMs": latest_probe.get("tcpMs", 0),
                    "TlsHandshakeMs": latest_probe.get("tlsMs", 0),
                    "TtfbMs": latest_probe.get("ttfbMs", 0),
                    "HttpStatusCode": latest_probe.get("statusCode", 0)
                }
                current_val = float(mapping[metric])
        elif metric == "S3BucketSizeBytes":
            current_val = float(total_s3_bytes)
        elif metric == "S3ObjectCount":
            current_val = float(len(s3_objects))
        elif metric == "ErrorProbeCount":
            current_val = float(sum(1 for p in probes if p.get("statusCode", 0) >= 400 or p.get("error")))

        if current_val is None:
            alarm["state"] = "INSUFFICIENT_DATA"
            alarm["currentValue"] = "No data yet"
            continue

        alarm["currentValue"] = round(current_val, 2)
        triggered = False
        if operator == ">" and current_val > threshold:
            triggered = True
        elif operator == ">=" and current_val >= threshold:
            triggered = True
        elif operator == "<" and current_val < threshold:
            triggered = True
        elif operator == "<=" and current_val <= threshold:
            triggered = True
        elif operator == "==" and current_val == threshold:
            triggered = True

        prev_state = alarm.get("state", "INSUFFICIENT_DATA")
        new_state = "ALARM" if triggered else "OK"
        alarm["state"] = new_state
        alarm["evaluatedAt"] = utc_now()

        if prev_state != new_state:
            append_log(
                state,
                "CloudWatch-Alarm",
                "ALERT" if new_state == "ALARM" else "INFO",
                f"Alarm '{alarm['name']}' transitioned {prev_state} -> {new_state} ({metric}={alarm['currentValue']} {operator} {threshold})"
            )


def measure_url_probe(raw_url: str) -> dict:
    url = raw_url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    host = parsed.hostname
    if not host:
        raise ValueError("Invalid URL hostname")

    port = parsed.port or (443 if scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query

    result = {
        "id": str(uuid.uuid4())[:8],
        "url": url,
        "host": host,
        "scheme": scheme.upper(),
        "port": port,
        "timestamp": utc_now(),
        "resolvedIp": None,
        "dnsMs": 0.0,
        "tcpMs": 0.0,
        "tlsMs": 0.0,
        "ttfbMs": 0.0,
        "totalMs": 0.0,
        "statusCode": 0,
        "reason": "",
        "tlsVersion": None,
        "tlsCipher": None,
        "headers": {},
        "contentLengthBytes": 0,
        "error": None
    }

    t_start = time.perf_counter()

    # 1. DNS Lookup Time
    t0 = time.perf_counter()
    addr_info = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
    t1 = time.perf_counter()
    result["dnsMs"] = round((t1 - t0) * 1000, 2)
    result["resolvedIp"] = addr_info[0][4][0] if addr_info else "Unknown"

    # 2. TCP Connect Time
    t2 = time.perf_counter()
    sock = socket.create_connection((host, port), timeout=10)
    t3 = time.perf_counter()
    result["tcpMs"] = round((t3 - t2) * 1000, 2)

    try:
        # 3. TLS Handshake Time
        if scheme == "https":
            ctx = ssl.create_default_context()
            t4 = time.perf_counter()
            tls_sock = ctx.wrap_socket(sock, server_hostname=host)
            t5 = time.perf_counter()
            result["tlsMs"] = round((t5 - t4) * 1000, 2)
            result["tlsVersion"] = tls_sock.version()
            cipher_info = tls_sock.cipher()
            result["tlsCipher"] = cipher_info[0] if cipher_info else None
            active_sock = tls_sock
        else:
            active_sock = sock

        # 4. HTTP TTFB
        req_lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}",
            "User-Agent: AWS-CloudPulse-Synthetics/1.0",
            "Accept: */*",
            "Connection: close",
            "",
            ""
        ]
        t6 = time.perf_counter()
        active_sock.sendall("\r\n".join(req_lines).encode("utf-8"))

        response = http.client.HTTPResponse(active_sock)
        response.begin()
        t7 = time.perf_counter()
        result["ttfbMs"] = round((t7 - t6) * 1000, 2)

        body = response.read(65536)
        t_end = time.perf_counter()

        result["statusCode"] = response.status
        result["reason"] = response.reason
        result["headers"] = {k: v for k, v in response.getheaders()}
        result["contentLengthBytes"] = len(body)
        result["totalMs"] = round((t_end - t_start) * 1000, 2)
    finally:
        try:
            sock.close()
        except Exception:
            pass

    return result


class CloudBackendHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def _serve_s3_download(self, filename: str):
        safe_name = os.path.basename(filename)
        file_path = (S3_STORAGE_DIR / safe_name).resolve()
        if not file_path.is_file():
            self._send_json({"error": "Object not found in S3 storage"}, status=404)
            return
        data = file_path.read_bytes()
        ctype, _ = mimetypes.guess_type(str(file_path))
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, req_path: str):
        if not DIST_DIR.exists():
            self._send_json({"error": "Frontend dist not built"}, status=404)
            return
        clean_path = req_path.lstrip("/") or "index.html"
        target_file = (DIST_DIR / clean_path).resolve()
        if not str(target_file).startswith(str(DIST_DIR)) or not target_file.is_file():
            target_file = DIST_DIR / "index.html"
        content = target_file.read_bytes()
        ctype, _ = mimetypes.guess_type(str(target_file))
        self.send_response(200)
        self.send_header("Content-Type", ctype or "text/html")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            auth = check_aws_auth()
            self._send_json({
                "status": "healthy",
                "service": "aws-live-cloud-backend",
                "aws": auth,
                "timestamp": utc_now()
            })
            return

        if parsed.path == "/api/state":
            auth = check_aws_auth()
            s3_client, cw_client, cf_client, _ = get_aws_clients()
            state = load_state()
            evaluate_alarms(state)
            save_state(state)
            s3_objects = list_s3_objects(s3_client, DEFAULT_BUCKET_NAME)
            real_buckets = list_real_s3_buckets(s3_client)
            real_cf_dists = list_real_cloudfront_distributions(cf_client)

            self._send_json({
                "timestamp": utc_now(),
                "aws": {
                    **auth,
                    "defaultBucket": DEFAULT_BUCKET_NAME,
                    "availableBuckets": real_buckets,
                    "cloudfrontDistributions": real_cf_dists
                },
                "s3": {
                    "bucketName": DEFAULT_BUCKET_NAME,
                    "region": DEFAULT_REGION,
                    "objectCount": len(s3_objects),
                    "totalSizeBytes": sum(o["sizeBytes"] for o in s3_objects),
                    "objects": s3_objects
                },
                "probes": state["probes"],
                "alarms": state["alarms"],
                "invalidations": state["invalidations"],
                "commandHistory": state.get("commandHistory", []),
                "logs": state["logs"]
            })
            return

        if parsed.path.startswith("/api/s3/download/"):
            filename = urllib.parse.unquote(parsed.path.replace("/api/s3/download/", "", 1))
            self._serve_s3_download(filename)
            return

        self._serve_static(parsed.path)

    def do_POST(self):
        global ACTIVE_SSO_PROC, DEFAULT_BUCKET_NAME
        parsed = urlparse(self.path)
        state = load_state()
        s3_client, cw_client, cf_client, _ = get_aws_clients()

        # 1. AWS BROWSER SSO LOGIN INITIATOR (Generates URL & Code Prompt)
        if parsed.path == "/api/aws/login-start":
            try:
                # Pre-configure region for profile sso-user
                subprocess.run(["aws", "configure", "set", "region", DEFAULT_REGION, "--profile", "sso-user"], check=False)
                
                # Terminate any old hanging login process
                if ACTIVE_SSO_PROC and ACTIVE_SSO_PROC.poll() is None:
                    ACTIVE_SSO_PROC.kill()

                ACTIVE_SSO_PROC = subprocess.Popen(
                    ["aws", "login", "--profile", "sso-user", "--remote"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    cwd=str(PROJECT_DIR)
                )

                # Read output until the URL appears
                accumulated = ""
                auth_url = None
                start_t = time.time()
                while time.time() - start_t < 6.0:
                    line = ACTIVE_SSO_PROC.stdout.readline()
                    if not line:
                        time.sleep(0.1)
                        continue
                    accumulated += line
                    match = re.search(r"https://[^\s]+authorize[^\s]+", line)
                    if match:
                        auth_url = match.group(0)
                        break

                append_log(state, "AWS-Auth", "INFO", "Started AWS browser SSO device login session")
                save_state(state)
                self._send_json({
                    "ok": True,
                    "authUrl": auth_url,
                    "rawOutput": accumulated,
                    "profile": "sso-user",
                    "requiresCode": True
                })
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        # 1B. SUBMIT BROWSER AUTHORIZATION CODE TO FINISH LOGIN
        if parsed.path == "/api/aws/login-submit-code":
            try:
                body = self._read_json_body()
                code = body.get("code", "").strip()
                if not code:
                    self._send_json({"error": "Authorization code is required"}, status=400)
                    return

                if not ACTIVE_SSO_PROC or ACTIVE_SSO_PROC.poll() is not None:
                    self._send_json({"error": "No active AWS login session in progress. Please start sign-in again."}, status=400)
                    return

                # Send code to the waiting process
                ACTIVE_SSO_PROC.stdin.write(code + "\n")
                ACTIVE_SSO_PROC.stdin.flush()

                # Wait for finish
                time.sleep(2.0)
                remaining_output = ""
                try:
                    remaining_output = ACTIVE_SSO_PROC.stdout.read()
                except Exception:
                    pass

                # Set sso-user credentials or switch default to sso-user
                subprocess.run(["aws", "configure", "set", "profile.default.source_profile", "sso-user"], check=False)
                auth = check_aws_auth()

                append_log(state, "AWS-Auth", "SUCCESS" if auth["authenticated"] else "INFO", f"Submitted authorization code: {remaining_output.strip() or 'Processed'}")
                save_state(state)
                self._send_json({
                    "ok": True,
                    "output": remaining_output,
                    "aws": auth
                })
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        # 1C. AWS SIGN OUT / LOGOUT
        if parsed.path == "/api/aws/logout":
            try:
                if ACTIVE_SSO_PROC and ACTIVE_SSO_PROC.poll() is None:
                    ACTIVE_SSO_PROC.kill()
                    ACTIVE_SSO_PROC = None

                # Backup or clear AWS credentials and sso cache in ~/.aws
                aws_dir = Path.home() / ".aws"
                creds_file = aws_dir / "credentials"
                config_file = aws_dir / "config"
                sso_cache_dir = aws_dir / "sso/cache"
                cli_cache_dir = aws_dir / "cli/cache"

                # Clear credentials file
                if creds_file.exists():
                    creds_file.write_text("", encoding="utf-8")

                # Remove AWS SSO cached tokens
                if sso_cache_dir.exists():
                    for token_file in sso_cache_dir.glob("*.json"):
                        try:
                            token_file.unlink()
                        except Exception:
                            pass

                # Remove CLI cache tokens
                if cli_cache_dir.exists():
                    for token_file in cli_cache_dir.glob("*.json"):
                        try:
                            token_file.unlink()
                        except Exception:
                            pass

                append_log(state, "AWS-Auth", "WARN", "Signed out of AWS. Local and cloud session cleared.")
                save_state(state)
                auth = check_aws_auth()
                self._send_json({"ok": True, "aws": auth})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        # 2. CONFIGURE AWS STATIC KEYS (Alternative to SSO)
        if parsed.path == "/api/aws/configure-keys":
            try:
                body = self._read_json_body()
                access_key = body.get("accessKey", "").strip()
                secret_key = body.get("secretKey", "").strip()
                region = body.get("region", DEFAULT_REGION).strip() or DEFAULT_REGION

                if not access_key or not secret_key:
                    self._send_json({"error": "Both Access Key ID and Secret Access Key are required"}, status=400)
                    return

                subprocess.run(["aws", "configure", "set", "aws_access_key_id", access_key], check=True)
                subprocess.run(["aws", "configure", "set", "aws_secret_access_key", secret_key], check=True)
                subprocess.run(["aws", "configure", "set", "region", region], check=True)
                subprocess.run(["aws", "configure", "set", "output", "json"], check=True)

                auth = check_aws_auth()
                append_log(state, "AWS-Auth", "SUCCESS", f"Updated AWS credentials for region {region}. Account: {auth.get('account')}")
                save_state(state)
                self._send_json({"ok": True, "aws": auth})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        # 3. DIRECT TERMINAL COMMAND RUNNER (Executes any command from commands.sh)
        if parsed.path == "/api/aws/run-command":
            try:
                body = self._read_json_body()
                cmd = body.get("command", "").strip()
                if not cmd:
                    self._send_json({"error": "No command provided"}, status=400)
                    return

                t_start = time.perf_counter()
                append_log(state, "AWS-Terminal", "INFO", f"Executing: {cmd}")

                # Run command inside WSL project environment
                proc = subprocess.run(
                    cmd,
                    shell=True,
                    cwd=str(PROJECT_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=30
                )
                duration_ms = round((time.perf_counter() - t_start) * 1000, 1)

                cmd_entry = {
                    "id": str(uuid.uuid4())[:8],
                    "command": cmd,
                    "exitCode": proc.returncode,
                    "output": proc.stdout or "[Command finished with no output]",
                    "durationMs": duration_ms,
                    "timestamp": utc_now()
                }

                if "commandHistory" not in state:
                    state["commandHistory"] = []
                state["commandHistory"].insert(0, cmd_entry)
                state["commandHistory"] = state["commandHistory"][:30]

                append_log(
                    state,
                    "AWS-Terminal",
                    "SUCCESS" if proc.returncode == 0 else "ERROR",
                    f"Command '{cmd[:40]}...' finished in {duration_ms}ms (Exit: {proc.returncode})"
                )
                save_state(state)
                self._send_json({"ok": True, "result": cmd_entry})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        # 4. SET ACTIVE S3 BUCKET NAME
        if parsed.path == "/api/aws/set-bucket":
            body = self._read_json_body()
            bucket_name = body.get("bucketName", "").strip()
            if bucket_name:
                DEFAULT_BUCKET_NAME = bucket_name
                append_log(state, "Amazon-S3", "INFO", f"Switched active S3 bucket to s3://{DEFAULT_BUCKET_NAME}")
                save_state(state)
            self._send_json({"ok": True, "bucketName": DEFAULT_BUCKET_NAME})
            return

        # 5. LIVE URL TELEMETRY PROBE + PUBLISH TO CLOUDWATCH
        if parsed.path == "/api/probe":
            try:
                body = self._read_json_body()
                target_url = body.get("url", "").strip()
                if not target_url:
                    self._send_json({"error": "Please provide a URL to probe."}, status=400)
                    return

                append_log(state, "CloudWatch-Synthetics", "INFO", f"Initiating live network probe for {target_url}")
                try:
                    probe_result = measure_url_probe(target_url)
                    state["probes"].insert(0, probe_result)
                    state["probes"] = state["probes"][:50]

                    cw_status_msg = ""
                    if cw_client:
                        publish_cloudwatch_metric(cw_client, "TotalLatencyMs", probe_result["totalMs"])
                        publish_cloudwatch_metric(cw_client, "DnsLookupMs", probe_result["dnsMs"])
                        publish_cloudwatch_metric(cw_client, "TlsHandshakeMs", probe_result["tlsMs"])
                        publish_cloudwatch_metric(cw_client, "TtfbMs", probe_result["ttfbMs"])
                        cw_status_msg = f" • [Pushed to AWS CloudWatch 'CloudPulse' namespace in {DEFAULT_REGION}]"

                    append_log(
                        state,
                        "CloudWatch-Metrics",
                        "SUCCESS" if 200 <= probe_result["statusCode"] < 400 else "WARN",
                        f"Probed {probe_result['url']} -> HTTP {probe_result['statusCode']} "
                        f"(DNS: {probe_result['dnsMs']}ms, TCP: {probe_result['tcpMs']}ms, "
                        f"TLS: {probe_result['tlsMs']}ms, TTFB: {probe_result['ttfbMs']}ms, Total: {probe_result['totalMs']}ms){cw_status_msg}"
                    )
                except Exception as probe_err:
                    err_entry = {
                        "id": str(uuid.uuid4())[:8],
                        "url": target_url,
                        "host": target_url,
                        "scheme": "ERROR",
                        "timestamp": utc_now(),
                        "dnsMs": 0,
                        "tcpMs": 0,
                        "tlsMs": 0,
                        "ttfbMs": 0,
                        "totalMs": 0,
                        "statusCode": 0,
                        "headers": {},
                        "error": str(probe_err)
                    }
                    state["probes"].insert(0, err_entry)
                    append_log(state, "CloudWatch-Synthetics", "ERROR", f"Probe failed for {target_url}: {probe_err}")

                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "probe": state["probes"][0]})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        # 6. S3 FILE UPLOAD (LOCAL + REAL AWS S3)
        if parsed.path == "/api/s3/upload":
            try:
                body = self._read_json_body()
                filename = os.path.basename(body.get("filename", "").strip())
                content_b64 = body.get("contentBase64", "")
                target_bucket = body.get("bucketName", DEFAULT_BUCKET_NAME).strip() or DEFAULT_BUCKET_NAME

                if not filename:
                    self._send_json({"error": "Filename is required"}, status=400)
                    return

                raw_bytes = base64.b64decode(content_b64) if content_b64 else b""
                dest = S3_STORAGE_DIR / filename
                dest.write_bytes(raw_bytes)
                etag = hashlib.md5(raw_bytes).hexdigest()
                ctype, _ = mimetypes.guess_type(filename)

                cloud_msg = ""
                if s3_client:
                    try:
                        s3_client.put_object(
                            Bucket=target_bucket,
                            Key=filename,
                            Body=raw_bytes,
                            ContentType=ctype or "application/octet-stream"
                        )
                        cloud_msg = f" [Uploaded directly to AWS S3: s3://{target_bucket}/{filename}]"
                    except Exception as s3_err:
                        cloud_msg = f" [Local Saved; AWS S3 note: {s3_err}]"

                append_log(
                    state,
                    "Amazon-S3",
                    "SUCCESS",
                    f"PUT Object {filename} ({len(raw_bytes)} bytes, MIME={ctype or 'application/octet-stream'}, ETag=\"{etag}\"){cloud_msg}"
                )
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "objects": list_s3_objects(s3_client, target_bucket)})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        # 7. CREATE S3 BUCKET DIRECTLY ON AWS
        if parsed.path == "/api/s3/create-bucket":
            try:
                body = self._read_json_body()
                new_bucket = body.get("bucketName", "").strip()
                if not new_bucket:
                    self._send_json({"error": "Bucket name is required"}, status=400)
                    return

                if not s3_client:
                    self._send_json({"error": "AWS session not active. Please authenticate first."}, status=401)
                    return

                if DEFAULT_REGION == "us-east-1":
                    s3_client.create_bucket(Bucket=new_bucket)
                else:
                    s3_client.create_bucket(
                        Bucket=new_bucket,
                        CreateBucketConfiguration={"LocationConstraint": DEFAULT_REGION}
                    )

                # Set Public Access Block
                s3_client.put_public_access_block(
                    Bucket=new_bucket,
                    PublicAccessBlockConfiguration={
                        "BlockPublicAcls": True,
                        "IgnorePublicAcls": True,
                        "BlockPublicPolicy": True,
                        "RestrictPublicBuckets": True
                    }
                )

                DEFAULT_BUCKET_NAME = new_bucket
                append_log(state, "Amazon-S3", "SUCCESS", f"Created AWS S3 bucket s3://{new_bucket} in {DEFAULT_REGION}")
                save_state(state)
                self._send_json({"ok": True, "bucketName": new_bucket})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        # 8. CREATE CLOUDWATCH ALARM
        if parsed.path == "/api/alarms":
            try:
                body = self._read_json_body()
                name = body.get("name", "").strip()
                metric = body.get("metric", "TotalLatencyMs").strip()
                operator = body.get("operator", ">").strip()
                threshold = float(body.get("threshold", 200))

                if not name:
                    self._send_json({"error": "Alarm name is required"}, status=400)
                    return

                new_alarm = {
                    "id": str(uuid.uuid4())[:8],
                    "name": name,
                    "metric": metric,
                    "operator": operator,
                    "threshold": threshold,
                    "state": "INSUFFICIENT_DATA",
                    "currentValue": "No data yet",
                    "createdAt": utc_now(),
                    "evaluatedAt": utc_now()
                }

                cw_sync_msg = ""
                if cw_client:
                    ok_sync, msg = sync_cloudwatch_alarm(cw_client, new_alarm)
                    if ok_sync:
                        cw_sync_msg = " [Synced to Real AWS CloudWatch Alarms]"

                state["alarms"].insert(0, new_alarm)
                append_log(
                    state,
                    "CloudWatch-Alarm",
                    "INFO",
                    f"Created CloudWatch Alarm '{name}': Trigger when {metric} {operator} {threshold}{cw_sync_msg}"
                )
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "alarm": new_alarm, "alarms": state["alarms"]})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        # 9. CLOUDFRONT CACHE INVALIDATION
        if parsed.path == "/api/cloudfront/invalidate":
            try:
                body = self._read_json_body()
                paths_raw = body.get("paths", "").strip()
                dist_id = body.get("distributionId", "").strip()

                if not paths_raw:
                    self._send_json({"error": "Enter at least one path pattern (e.g. /*)"}, status=400)
                    return

                paths_list = [p.strip() for p in paths_raw.split(",") if p.strip()]
                inv_id = "I" + uuid.uuid4().hex[:13].upper()

                cf_real_msg = ""
                if cf_client and dist_id:
                    try:
                        cf_client.create_invalidation(
                            DistributionId=dist_id,
                            InvalidationBatch={
                                "Paths": {
                                    "Quantity": len(paths_list),
                                    "Items": paths_list
                                },
                                "CallerReference": str(time.time())
                            }
                        )
                        cf_real_msg = f" [Dispatched to Live CloudFront Dist {dist_id}]"
                    except Exception as cf_err:
                        cf_real_msg = f" [CloudFront API: {cf_err}]"

                s3_objs = list_s3_objects(s3_client, DEFAULT_BUCKET_NAME)
                matched_files = []
                for obj in s3_objs:
                    key_path = "/" + obj["key"]
                    for pattern in paths_list:
                        if pattern in ("/*", "*", key_path) or (pattern.endswith("*") and key_path.startswith(pattern[:-1])):
                            matched_files.append(obj["key"])
                            break

                inv_record = {
                    "id": inv_id,
                    "paths": paths_list,
                    "matchedObjectsCount": len(matched_files),
                    "matchedObjects": matched_files,
                    "status": "Completed",
                    "createdAt": utc_now()
                }
                state["invalidations"].insert(0, inv_record)
                append_log(
                    state,
                    "Amazon-CloudFront",
                    "SUCCESS",
                    f"Created Invalidation {inv_id} for paths {paths_list} — Purged {len(matched_files)} matching S3 edge object(s){cf_real_msg}"
                )
                save_state(state)
                self._send_json({"ok": True, "invalidation": inv_record})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        # 10. CLEAR LOGS / PROBES / COMMANDS
        if parsed.path == "/api/clear":
            body = self._read_json_body()
            target = body.get("target", "logs")
            if target == "logs":
                state["logs"] = []
            elif target == "probes":
                state["probes"] = []
                evaluate_alarms(state)
            elif target == "commands":
                state["commandHistory"] = []
            save_state(state)
            self._send_json({"ok": True})
            return

        self._send_json({"error": "Endpoint not found"}, status=404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        state = load_state()
        s3_client, cw_client, cf_client, _ = get_aws_clients()

        if parsed.path.startswith("/api/s3/object/"):
            filename = urllib.parse.unquote(parsed.path.replace("/api/s3/object/", "", 1))
            safe_name = os.path.basename(filename)
            target = S3_STORAGE_DIR / safe_name
            if target.is_file():
                target.unlink()

            cloud_del_msg = ""
            if s3_client:
                try:
                    s3_client.delete_object(Bucket=DEFAULT_BUCKET_NAME, Key=safe_name)
                    cloud_del_msg = f" [Deleted from Real AWS S3 Bucket s3://{DEFAULT_BUCKET_NAME}]"
                except Exception:
                    pass

            append_log(state, "Amazon-S3", "WARN", f"DELETE Object {safe_name}{cloud_del_msg}")
            evaluate_alarms(state)
            save_state(state)
            self._send_json({"ok": True, "objects": list_s3_objects(s3_client, DEFAULT_BUCKET_NAME)})
            return

        if parsed.path.startswith("/api/alarms/"):
            alarm_id = parsed.path.replace("/api/alarms/", "", 1).strip()
            target_alarm = next((a for a in state["alarms"] if a["id"] == alarm_id), None)
            if target_alarm and cw_client:
                try:
                    cw_client.delete_alarms(AlarmNames=[f"CloudPulse-{target_alarm['name']}"])
                except Exception:
                    pass

            before = len(state["alarms"])
            state["alarms"] = [a for a in state["alarms"] if a["id"] != alarm_id]
            if len(state["alarms"]) < before:
                append_log(state, "CloudWatch-Alarm", "WARN", f"Deleted CloudWatch Alarm ID {alarm_id}")
            save_state(state)
            self._send_json({"ok": True, "alarms": state["alarms"]})
            return

        self._send_json({"error": "Not found"}, status=404)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = ReusableThreadingHTTPServer(("0.0.0.0", port), CloudBackendHandler)
    print(f"Live AWS Cloud Operations Backend listening on http://localhost:{port}", flush=True)
    server.serve_forever()
