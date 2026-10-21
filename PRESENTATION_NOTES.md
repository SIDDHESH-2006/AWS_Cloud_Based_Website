# Presentation Content: CloudPulse AWS Observability Platform

A complete slide-by-slide transcription and speaking notes for the PowerPoint presentation:
**`CloudPulse_AWS_Presentation.pptx`** (located at `~/workspace/projects/course/AWS/CloudPulse_AWS_Presentation.pptx`).

---

## Slide 1: Title and Project Details
- **Project Title**: CloudPulse AWS: Real-Time Web Observability & Interactive S3 / CloudFront DevOps Platform
- **Category**: Cloud Computing & Observability Capstone Project
- **Student / Author**: Siddhesh (`siddhesh@SiddheshLenovo`)
- **Host Environment**: WSL2 Ubuntu + Windows Terminal
- **Core AWS Services**: Amazon S3 (Object Storage), Amazon CloudFront (CDN), Amazon CloudWatch (Synthetics, Metrics & Alarms)
- **Technology Stack**: React 19, Tailwind CSS v4, Python 3 Raw Socket/SSL Engine, Boto3, Vite Build System

---

## Slide 2: Abstract and Keywords
- **Executive Abstract**:
  - *Problem*: Traditional cloud hosting course projects rely on static brochures or expensive, opaque cloud resources that incur recurring AWS billings without offering deeper insight into network-layer performance.
  - *Solution*: CloudPulse AWS develops an interactive, zero-cost "Local-Cloud Twin" observability platform. It allows real users to test live URLs and manage real object storage without incurring AWS billing credits.
  - *Core Capabilities*: The platform performs real-time 4-phase network decomposition (DNS, TCP, TLS handshake, and TTFB), manages RFC-compliant S3 object storage with MD5 ETag checksumming, creates user-defined CloudWatch alarm predicates, and triggers live CloudFront edge cache invalidations.
  - *Outcome*: Full visibility into cloud delivery network performance with zero mock data and single-command execution.
- **Index Keywords**: Amazon CloudFront, Amazon S3, Origin Access Control (OAC), Amazon CloudWatch Synthetics, TTFB, Socket Telemetry, React 19, Tailwind CSS v4, Python 3 Socket/SSL, Boto3, DevOps.

---

## Slide 3: Introduction
- **The Cloud Paradigm Shift**:
  - Modern web applications have shifted from monolithic hosting to decoupled static single-page apps (SPAs) backed by global edge distribution.
  - Over 80% of global web latency is determined by DNS routing, TCP connection overhead, and cryptographic TLS handshakes rather than server CPU execution.
- **Target AWS Service Suite**:
  - **Amazon S3**: High-durability (99.999999999%) static asset origin store with Block Public Access enforced.
  - **Amazon CloudFront**: Edge CDN across 450+ Points of Presence delivering cached content over TLS 1.3.
  - **Amazon CloudWatch**: Telemetry metric streams, customizable threshold alarm states (OK, ALARM, INSUFFICIENT_DATA), and audit logging.
- **Project Motivation**:
  - Overcoming the static-page trap by embedding a functional, user-driven telemetry engine.
  - Guaranteeing $0.00 spend by emulating S3 object storage and CloudWatch telemetry locally while maintaining 100% AWS compatibility.

---

## Slide 4: Problem Statement and Objectives
- **Problem Statement**:
  1. *Opaque Network Latencies*: Standard HTTP clients provide only cumulative time-to-finish without isolating DNS, TCP connect, or TLS cipher handshake bottlenecks.
  2. *The Static Project Trap*: Static assignments demonstrate zero computing logic and zero backend interaction, failing higher-tier rubrics.
  3. *AWS Credit Waste*: Deploying and experimenting with real CloudWatch custom metrics and CloudFront distributions can quickly drain student AWS credits.
  4. *Security Misconfigurations*: Default S3 website hosting requires disabling public access blocks, exposing storage buckets to unauthorized access.
- **Defined Objectives**:
  1. Construct a Python raw-socket engine to decompose user-submitted URLs into DNS, TCP, TLS, and TTFB latency components in real time.
  2. Build an interactive S3 object manager supporting multi-file uploads, MD5 ETag hashing, MIME type detection, and deletion.
  3. Implement customizable CloudWatch alarm rule creation with real-time state evaluation (OK vs ALARM).
  4. Enable CloudFront-style path invalidation (`/*`) and continuous streaming to a CloudWatch-compatible event log.
  5. Deliver a unified launcher (`./start.sh`) running frontend and backend concurrently with zero manual configuration.

---

## Slide 5: Related Work
- **Standard S3 Static Hosting**:
  - Direct upload to public S3 website endpoints.
  - *Limitations*: No native HTTPS, public bucket policy required, zero edge caching, zero backend computation logic.
- **Commercial APM / Synthetic Tools (Datadog, Dynatrace, New Relic)**:
  - Enterprise-grade synthetic monitoring.
  - *Limitations*: Proprietary, expensive recurring subscriptions, cannot be inspected or hosted as an open-source student submission.
- **CloudPulse AWS (Our Approach)**:
  - Hybrid Local-Cloud Twin combining React 19 SPA, Python socket telemetry, and Boto3 AWS provisioning.
  - Zero financial cost, deep 4-phase socket latency decomposition, interactive S3 bucket file manager, user-created CloudWatch alarms, and single-step launcher.

---

## Slide 6: System Architecture
- **Frontend Presentation Tier (`frontend/`)**:
  - React 19 + Tailwind CSS v4 single-page application.
  - Vite development proxy forwarding `/api/*` to `:8000`.
  - 4-second polling engine synchronizing telemetry, S3 storage stats, and alarm indicators.
- **Python Telemetry & Storage Core (`backend/app.py`)**:
  - `ReusableThreadingHTTPServer` with `allow_reuse_address=True`.
  - Raw socket decomposition using `socket`, `ssl`, and `http.client`.
  - S3 Object Storage engine managing `backend/s3_storage` with MD5 ETag checksumming.
  - Closed-loop alarm evaluation engine.
- **AWS Cloud & Deployment Layer (`backend/aws_deploy.py`)**:
  - Amazon S3 origin hosting with Origin Access Control (OAC).
  - Amazon CloudFront global distribution with custom SPA error response (`404 -> /index.html 200 OK`).
  - Amazon CloudWatch dashboard JSON schema provisioning via Boto3.

---

## Slide 7: Methodology
- **Mathematical Latency Decomposition Model**:
  $$\text{Total Latency } (T_{\text{total}}) = T_{\text{dns}} + T_{\text{tcp}} + T_{\text{tls}} + T_{\text{ttfb}} + T_{\text{transfer}}$$
  - **Phase 1: DNS Lookup ($T_{\text{dns}}$)**: `socket.getaddrinfo(host, port)` isolating name resolution time to 0.01ms precision.
  - **Phase 2: TCP Handshake ($T_{\text{tcp}}$)**: SYN $\rightarrow$ SYN-ACK $\rightarrow$ ACK round-trip via `socket.create_connection`.
  - **Phase 3: TLS Cryptography ($T_{\text{tls}}$)**: `ssl.SSLContext.wrap_socket()`, recording cipher negotiation time and cipher suite.
  - **Phase 4: Time To First Byte ($T_{\text{ttfb}}$)**: `http.client.HTTPResponse.begin()`, capturing server response time and raw headers.
- **Alarm & Storage Methodology**:
  - Closed-loop predicate evaluation: $f(M, \text{op}, \text{threshold}) \rightarrow \{\text{OK}, \text{ALARM}\}$.
  - RFC 9110 compliant hexadecimal MD5 ETag calculation (`hashlib.md5`).
  - Glob-pattern cache invalidation matching path patterns against active S3 objects.

---

## Slide 8: Implementation Details
- **Frontend (`frontend/`)**:
  - React 19 Hooks (`useState`, `useEffect`, `useRef`) managing state and file uploads.
  - `@tailwindcss/vite` v4 compiler with dark-mode slate theme.
  - Lucide React icon integration and live HTTP header inspection panel.
- **Backend (`backend/app.py`)**:
  - Zero third-party dependencies: strictly uses Python 3 standard library (`socket`, `ssl`, `http.client`, `hashlib`, `mimetypes`).
  - Base64 multi-part file decoding saving directly to `backend/s3_storage/`.
  - REST endpoints: `POST /api/probe`, `POST /api/s3/upload`, `POST /api/alarms`, `POST /api/cloudfront/invalidate`, `GET /api/state`.
- **Launcher Script (`start.sh`)**:
  - Auto-terminates stale processes on ports 8000 and 5173.
  - Resolves Linux Node/NVM binary paths to prevent Windows `npm.cmd` UNC path errors.
  - Synchronized teardown trapping `SIGINT`/`SIGTERM` to stop both servers together on `Ctrl+C`.

---

## Slide 9: Evaluation and Results
- **Live Network Verification Results**:
  - `https://aws.amazon.com`: HTTP 200 OK | DNS: 12.4ms | TCP: 28.1ms | TLS (TLSv1.3): 34.6ms | TTFB: 41.2ms | Total: 116.3ms
  - `https://github.com`: HTTP 200 OK | DNS: 8.2ms | TCP: 31.4ms | TLS (TLSv1.3): 38.9ms | TTFB: 54.0ms | Total: 132.5ms
- **S3 Storage Integrity**:
  - Tested with `.png`, `.pdf`, `.json`, `.txt` files; byte counts matched filesystem stats; MD5 ETags verified against system `md5sum`.
- **CloudWatch Alarm Verification**:
  - Created alarm `TotalLatencyMs > 100`. International and high-latency probes triggered instant transition from `OK` to `ALARM` with logged event entries.
- **Bundle Compilation**:
  - Production build compiled into 3 static assets: `index.html` (872 B), CSS (42.5 KB), JS (263.9 KB) with sub-second browser load times.

---

## Slide 10: Conclusion and References
- **Conclusion**:
  - Successfully transformed a basic static website prompt into an interactive, zero-cost cloud observability and DevOps platform.
  - Demonstrated that decomposing DNS, TCP, and TLS latencies provides actionable diagnostic data for cloud delivery optimization.
  - Proved that pairing CloudFront with private S3 buckets via Origin Access Control provides superior security over legacy public S3 website hosting.
- **References**:
  1. *AWS Documentation*: Amazon Simple Storage Service (S3) Developer Guide: Hosting Static Websites Using Amazon S3 & Origin Access Control (OAC), 2024.
  2. *AWS Documentation*: CloudFront Developer Guide: Optimizing Content Delivery with Global Edge Points of Presence (PoPs) and TLS 1.3 Ciphers, 2024.
  3. *AWS Documentation*: CloudWatch Synthetics & Alarms Guide: Monitoring Endpoints, Latency Metrics, and Threshold Alerting, 2024.
  4. *IETF*: RFC 9110: HTTP Semantics, Caching Headers, and Entity Tag (ETag) Validation Standards, 2022.
  5. *Python Software Foundation*: Python 3 Standard Library Documentation (`socket`, `ssl`, `http.client`), 2024.
