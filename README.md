# Cloud-Based Website with Monitoring (AWS S3 + CloudFront + CloudWatch)

A full-featured cloud deployment and observability project built with **React 19 + Tailwind CSS v4** on the frontend and **Python 3** for live CloudWatch telemetry and automated AWS provisioning.

## Project Structure

- `frontend/` — React + Tailwind CSS single-page application:
  - **Homepage**: Project introduction and live deployment health summary card.
  - **CloudWatch Dashboard**: Interactive 24-hour metric visualization (`Requests`, `CacheHitRate`, `OriginLatency`), top CloudFront Edge PoP table, S3 storage metrics, and interactive traffic-spike alarm simulator.
  - **AWS Architecture Section**: Interactive comparison between **CloudFront + Private S3 (OAC with HTTPS)** and **Basic Public S3 Website Endpoint (HTTP)**.
  - **Footer**: Complete course and AWS service metadata.
- `backend/` — Python 3 telemetry & provisioning utilities:
  - `app.py`: Lightweight HTTP telemetry backend serving `/api/metrics` and `/api/health` (integrates with `boto3` when AWS credentials are set, or simulates live CloudWatch metrics locally).
  - `aws_deploy.py`: Automated provisioning script for S3 static asset upload, CloudFront Origin Access Control (OAC), and CloudWatch Dashboard JSON creation.

## Quick Start (Local Development & Verification)

```bash
# 1. Start the Python CloudWatch Telemetry Backend (:8000)
cd ~/workspace/projects/course/AWS/backend
python3 app.py &

# 2. Start the React + Tailwind Frontend (:5173)
cd ~/workspace/projects/course/AWS/frontend
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm run dev
```
