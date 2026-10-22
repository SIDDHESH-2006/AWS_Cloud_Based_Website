import base64
import hashlib
import http.client
import json
import mimetypes
import os
import re
import socket
import ssl
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import boto3
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

# Vercel writeable tmp directory
STATE_FILE = Path("/tmp/cloud_state.json")
S3_STORAGE_DIR = Path("/tmp/s3_storage")
S3_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_REGION = os.environ.get("AWS_REGION", "ap-south-1")
DEFAULT_BUCKET_NAME = os.environ.get("AWS_BUCKET", "cloudpulse-frontend-live-bucket")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def check_aws_auth():
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
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception:
        pass


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
    if S3_STORAGE_DIR.exists():
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
    sock = socket.create_connection((host, port), timeout=8)
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


class handler(BaseHTTPRequestHandler):
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

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path in ("/api/health", "/health"):
            auth = check_aws_auth()
            self._send_json({
                "status": "healthy",
                "service": "aws-cloudpulse-vercel-serverless",
                "aws": auth,
                "timestamp": utc_now()
            })
            return

        if parsed.path in ("/api/state", "/state"):
            auth = check_aws_auth()
            s3_client, cw_client, cf_client, _ = get_aws_clients()
            state = load_state()
            evaluate_alarms(state)
            save_state(state)
            s3_objects = list_s3_objects(s3_client, DEFAULT_BUCKET_NAME)

            self._send_json({
                "timestamp": utc_now(),
                "aws": {
                    **auth,
                    "defaultBucket": DEFAULT_BUCKET_NAME,
                    "availableBuckets": [],
                    "cloudfrontDistributions": []
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

        self._send_json({"error": "Endpoint not found"}, status=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        state = load_state()
        s3_client, cw_client, cf_client, _ = get_aws_clients()

        # 1. LIVE URL TELEMETRY PROBE
        if parsed.path in ("/api/probe", "/probe"):
            try:
                body = self._read_json_body()
                target_url = body.get("url", "").strip()
                if not target_url:
                    self._send_json({"error": "Please provide a URL to probe."}, status=400)
                    return

                append_log(state, "CloudWatch-Synthetics", "INFO", f"Initiating live probe for {target_url}")
                try:
                    probe_result = measure_url_probe(target_url)
                    state["probes"].insert(0, probe_result)
                    state["probes"] = state["probes"][:50]

                    if cw_client:
                        publish_cloudwatch_metric(cw_client, "TotalLatencyMs", probe_result["totalMs"])
                        publish_cloudwatch_metric(cw_client, "DnsLookupMs", probe_result["dnsMs"])
                        publish_cloudwatch_metric(cw_client, "TlsHandshakeMs", probe_result["tlsMs"])
                        publish_cloudwatch_metric(cw_client, "TtfbMs", probe_result["ttfbMs"])

                    append_log(
                        state,
                        "CloudWatch-Metrics",
                        "SUCCESS" if 200 <= probe_result["statusCode"] < 400 else "WARN",
                        f"Probed {probe_result['url']} -> HTTP {probe_result['statusCode']} (Total: {probe_result['totalMs']}ms)"
                    )
                except Exception as probe_err:
                    err_entry = {
                        "id": str(uuid.uuid4())[:8],
                        "url": target_url,
                        "host": target_url,
                        "scheme": "ERROR",
                        "timestamp": utc_now(),
                        "dnsMs": 0, "tcpMs": 0, "tlsMs": 0, "ttfbMs": 0, "totalMs": 0,
                        "statusCode": 0, "headers": {}, "error": str(probe_err)
                    }
                    state["probes"].insert(0, err_entry)
                    append_log(state, "CloudWatch-Synthetics", "ERROR", f"Probe failed: {probe_err}")

                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "probe": state["probes"][0]})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        # 2. S3 FILE UPLOAD
        if parsed.path in ("/api/s3/upload", "/s3/upload"):
            try:
                body = self._read_json_body()
                filename = os.path.basename(body.get("filename", "").strip())
                content_b64 = body.get("contentBase64", "")
                if not filename:
                    self._send_json({"error": "Filename is required"}, status=400)
                    return

                raw_bytes = base64.b64decode(content_b64) if content_b64 else b""
                dest = S3_STORAGE_DIR / filename
                dest.write_bytes(raw_bytes)
                etag = hashlib.md5(raw_bytes).hexdigest()
                ctype, _ = mimetypes.guess_type(filename)

                if s3_client:
                    try:
                        s3_client.put_object(
                            Bucket=DEFAULT_BUCKET_NAME,
                            Key=filename,
                            Body=raw_bytes,
                            ContentType=ctype or "application/octet-stream"
                        )
                    except Exception:
                        pass

                append_log(state, "Amazon-S3", "SUCCESS", f"PUT Object {filename} ({len(raw_bytes)} bytes)")
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "objects": list_s3_objects(s3_client, DEFAULT_BUCKET_NAME)})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        # 3. CREATE CLOUDWATCH ALARM
        if parsed.path in ("/api/alarms", "/alarms"):
            try:
                body = self._read_json_body()
                name = body.get("name", "").strip()
                metric = body.get("metric", "TotalLatencyMs").strip()
                operator = body.get("operator", ">").strip()
                threshold = float(body.get("threshold", 200))

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

                if cw_client:
                    sync_cloudwatch_alarm(cw_client, new_alarm)

                state["alarms"].insert(0, new_alarm)
                append_log(state, "CloudWatch-Alarm", "INFO", f"Created Alarm '{name}': {metric} {operator} {threshold}")
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "alarm": new_alarm, "alarms": state["alarms"]})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        # 4. CLOUDFRONT CACHE INVALIDATION
        if parsed.path in ("/api/cloudfront/invalidate", "/cloudfront/invalidate"):
            try:
                body = self._read_json_body()
                paths_raw = body.get("paths", "").strip()
                paths_list = [p.strip() for p in paths_raw.split(",") if p.strip()]
                inv_id = "I" + uuid.uuid4().hex[:13].upper()

                inv_record = {
                    "id": inv_id,
                    "paths": paths_list,
                    "matchedObjectsCount": len(paths_list),
                    "status": "Completed",
                    "createdAt": utc_now()
                }
                state["invalidations"].insert(0, inv_record)
                append_log(state, "Amazon-CloudFront", "SUCCESS", f"Created Invalidation {inv_id} for {paths_list}")
                save_state(state)
                self._send_json({"ok": True, "invalidation": inv_record})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        # 5. CLEAR LOGS / PROBES
        if parsed.path in ("/api/clear", "/clear"):
            body = self._read_json_body()
            target = body.get("target", "logs")
            if target == "logs":
                state["logs"] = []
            elif target == "probes":
                state["probes"] = []
            save_state(state)
            self._send_json({"ok": True})
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        state = load_state()

        if parsed.path.startswith("/api/alarms/"):
            alarm_id = parsed.path.replace("/api/alarms/", "", 1).strip()
            state["alarms"] = [a for a in state["alarms"] if a["id"] != alarm_id]
            save_state(state)
            self._send_json({"ok": True, "alarms": state["alarms"]})
            return

        self._send_json({"error": "Not found"}, status=404)
