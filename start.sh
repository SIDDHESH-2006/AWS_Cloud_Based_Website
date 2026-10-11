#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/home/siddhesh/.nvm/versions/node/v22.23.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

echo "============================================================"
echo "  Starting AWS Cloud-Based Website with Monitoring"
echo "============================================================"

# 1. Stop any old backend or vite processes (without killing this script)
for pid in $(pgrep -f "backend/app.py|python3 app.py|node_modules/.bin/vite" 2>/dev/null || true); do
  if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then
    kill -9 "$pid" 2>/dev/null || true
  fi
done
sleep 0.5

# 2. Ensure frontend dependencies are installed
cd "$PROJECT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

# 3. Start Python CloudWatch Telemetry Backend (:8000)
echo "[1/2] Starting Python CloudWatch Telemetry Backend on http://localhost:8000 ..."
cd "$PROJECT_DIR/backend"
python3 app.py &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "Stopping backend (PID $BACKEND_PID) and frontend..."
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 4. Start React + Tailwind Vite Server (:5173)
echo "[2/2] Starting React + Tailwind Frontend on http://localhost:5173 ..."
echo "------------------------------------------------------------"
echo "  Frontend Website : http://localhost:5173"
echo "  Full-Stack Port  : http://localhost:8000"
echo "  Backend Metrics  : http://localhost:8000/api/metrics"
echo "  Press Ctrl+C to stop both servers."
echo "------------------------------------------------------------"

cd "$PROJECT_DIR/frontend"
./node_modules/.bin/vite --host 0.0.0.0 --port 5173
