#!/usr/bin/env python3
"""
Real-Time Cloud Website Monitoring, S3 Bucket File Manager,
CloudFront Cache Invalidation & CloudWatch Alarm Engine
-----------------------------------------------------------
No hardcoded sample inputs. Every metric, file object, alarm evaluation,
cache invalidation, and log event is generated from real user interactions.
"""

import base64
import hashlib
import http.client
import json
import mimetypes
import os
import socket
import ssl
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import boto3
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parent
S3_STORAGE_DIR = BASE_DIR / "s3_storage"
STATE_FILE = BASE_DIR / "cloud_state.json"
DIST_DIR = (BASE_DIR / "../frontend/dist").resolve()

S3_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


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
    state["logs"] = state["logs"][:100]


def list_s3_objects() -> list:
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
                "storageClass": "STANDARD"
            })
    return objects


def evaluate_alarms(state: dict):
    """Evaluate all user-created CloudWatch alarms against real telemetry."""
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
    """Perform a real network probe measuring DNS, TCP, TLS, TTFB, status code, and headers."""
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

    # 1. Measure DNS Lookup Time
    t0 = time.perf_counter()
    addr_info = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
    t1 = time.perf_counter()
    result["dnsMs"] = round((t1 - t0) * 1000, 2)
    result["resolvedIp"] = addr_info[0][4][0] if addr_info else "Unknown"

    # 2. Measure TCP Connect Time
    t2 = time.perf_counter()
    sock = socket.create_connection((host, port), timeout=10)
    t3 = time.perf_counter()
    result["tcpMs"] = round((t3 - t2) * 1000, 2)

    try:
        # 3. Measure TLS Handshake Time (if HTTPS)
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

        # 4. Send HTTP Request & Measure Time To First Byte (TTFB)
        req_lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}",
            "User-Agent: AWS-CloudWatch-Synthetics-Probe/1.0",
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

        body = response.read(65536)  # Read up to 64KB
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
            self._send_json({"error": "Object not found in S3 bucket"}, status=404)
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
            self._send_json({
                "status": "healthy",
                "service": "aws-live-cloud-backend",
                "timestamp": utc_now()
            })
            return

        if parsed.path == "/api/state":
            state = load_state()
            evaluate_alarms(state)
            save_state(state)
            s3_objects = list_s3_objects()
            self._send_json({
                "timestamp": utc_now(),
                "s3": {
                    "bucketName": "siddhesh-course-aws-live-bucket",
                    "region": "us-east-1",
                    "objectCount": len(s3_objects),
                    "totalSizeBytes": sum(o["sizeBytes"] for o in s3_objects),
                    "objects": s3_objects
                },
                "probes": state["probes"],
                "alarms": state["alarms"],
                "invalidations": state["invalidations"],
                "logs": state["logs"]
            })
            return

        if parsed.path.startswith("/api/s3/download/"):
            filename = urllib.parse.unquote(parsed.path.replace("/api/s3/download/", "", 1))
            self._serve_s3_download(filename)
            return

        self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        state = load_state()

        # 1. LIVE URL TELEMETRY PROBE
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
                    append_log(
                        state,
                        "CloudWatch-Metrics",
                        "SUCCESS" if 200 <= probe_result["statusCode"] < 400 else "WARN",
                        f"Probed {probe_result['url']} -> HTTP {probe_result['statusCode']} "
                        f"(DNS: {probe_result['dnsMs']}ms, TCP: {probe_result['tcpMs']}ms, "
                        f"TLS: {probe_result['tlsMs']}ms, TTFB: {probe_result['ttfbMs']}ms, Total: {probe_result['totalMs']}ms)"
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

        # 2. INTERACTIVE S3 FILE UPLOAD
        if parsed.path == "/api/s3/upload":
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

                append_log(
                    state,
                    "Amazon-S3",
                    "SUCCESS",
                    f"PUT Object s3://siddhesh-course-aws-live-bucket/{filename} ({len(raw_bytes)} bytes, MIME={ctype or 'application/octet-stream'}, ETag=\"{etag}\")"
                )
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "objects": list_s3_objects()})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        # 3. CREATE CUSTOM CLOUDWATCH ALARM
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
                state["alarms"].insert(0, new_alarm)
                append_log(
                    state,
                    "CloudWatch-Alarm",
                    "INFO",
                    f"Created custom CloudWatch Alarm '{name}': Trigger when {metric} {operator} {threshold}"
                )
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "alarm": new_alarm, "alarms": state["alarms"]})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        # 4. TRIGGER CLOUDFRONT CACHE INVALIDATION
        if parsed.path == "/api/cloudfront/invalidate":
            try:
                body = self._read_json_body()
                paths_raw = body.get("paths", "").strip()
                if not paths_raw:
                    self._send_json({"error": "Enter at least one path pattern (e.g., /* or /index.html)"}, status=400)
                    return

                paths_list = [p.strip() for p in paths_raw.split(",") if p.strip()]
                inv_id = "I" + uuid.uuid4().hex[:13].upper()

                # Check how many S3 objects match the invalidation pattern
                s3_objs = list_s3_objects()
                matched_files = []
                for obj in s3_objs:
                    key_path = "/" + obj["key"]
                    for pattern in paths_list:
                        if pattern == "/*" or pattern == "*" or pattern == key_path or (pattern.endswith("*") and key_path.startswith(pattern[:-1])):
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
                    f"Created Invalidation {inv_id} for paths {paths_list} — Purged {len(matched_files)} matching S3 edge object(s)"
                )
                save_state(state)
                self._send_json({"ok": True, "invalidation": inv_record})
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        # 5. CLEAR LOGS OR PROBES
        if parsed.path == "/api/clear":
            body = self._read_json_body()
            target = body.get("target", "logs")
            if target == "logs":
                state["logs"] = []
            elif target == "probes":
                state["probes"] = []
                evaluate_alarms(state)
            save_state(state)
            self._send_json({"ok": True})
            return

        self._send_json({"error": "Endpoint not found"}, status=404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        state = load_state()

        if parsed.path.startswith("/api/s3/object/"):
            filename = urllib.parse.unquote(parsed.path.replace("/api/s3/object/", "", 1))
            safe_name = os.path.basename(filename)
            target = S3_STORAGE_DIR / safe_name
            if target.is_file():
                target.unlink()
                append_log(state, "Amazon-S3", "WARN", f"DELETE Object s3://siddhesh-course-aws-live-bucket/{safe_name}")
                evaluate_alarms(state)
                save_state(state)
                self._send_json({"ok": True, "objects": list_s3_objects()})
            else:
                self._send_json({"error": "File not found"}, status=404)
            return

        if parsed.path.startswith("/api/alarms/"):
            alarm_id = parsed.path.replace("/api/alarms/", "", 1).strip()
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
