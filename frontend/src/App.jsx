import React, { useState, useEffect, useRef } from 'react';
import {
  Cloud,
  Activity,
  Globe,
  Database,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Lock,
  Zap,
  Terminal,
  BarChart3,
  Clock,
  Layers,
  HardDrive,
  Upload,
  Trash2,
  Eye,
  PlusCircle,
  Send,
  FileText,
  Download,
  ShieldAlert,
  Sparkles,
  Server
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function App() {
  const [cloudState, setCloudState] = useState({
    s3: { bucketName: 'siddhesh-course-aws-live-bucket', region: 'us-east-1', objectCount: 0, totalSizeBytes: 0, objects: [] },
    probes: [],
    alarms: [],
    invalidations: [],
    logs: []
  });
  const [backendOnline, setBackendOnline] = useState(false);

  // 1. Live URL Probe Form State
  const [urlInput, setUrlInput] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [selectedProbe, setSelectedProbe] = useState(null);

  // 2. Interactive S3 File Manager State
  const [uploading, setUploading] = useState(false);
  const [inspectedObject, setInspectedObject] = useState(null);
  const fileInputRef = useRef(null);

  // 3. CloudFront Cache Invalidation & Custom CloudWatch Alarm Creator State
  const [invalidationPaths, setInvalidationPaths] = useState('');
  const [invalidating, setInvalidating] = useState(false);

  const [alarmName, setAlarmName] = useState('');
  const [alarmMetric, setAlarmMetric] = useState('TotalLatencyMs');
  const [alarmOperator, setAlarmOperator] = useState('>');
  const [alarmThreshold, setAlarmThreshold] = useState('');
  const [creatingAlarm, setCreatingAlarm] = useState(false);

  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        setCloudState(data);
        setBackendOnline(true);
        if (data.probes.length > 0 && !selectedProbe) {
          setSelectedProbe(data.probes[0]);
        }
      } else {
        setBackendOnline(false);
      }
    } catch {
      setBackendOnline(false);
    }
  };

  useEffect(() => {
    fetchState();
    const timer = setInterval(fetchState, 4000);
    return () => clearInterval(timer);
  }, []);

  // Handler 1: Run Real-Time URL Probe
  const handleRunProbe = async (e) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setProbing(true);
    setProbeError('');
    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setProbeError(data.error || 'Failed to probe URL');
      } else {
        setSelectedProbe(data.probe);
        setUrlInput('');
        await fetchState();
      }
    } catch (err) {
      setProbeError(err.message);
    } finally {
      setProbing(false);
    }
  };

  // Handler 2: Upload Real File to S3 Bucket Storage
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const base64Content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result || '';
            const base64 = result.includes(',') ? result.split(',')[1] : '';
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await fetch('/api/s3/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentBase64: base64Content
          })
        });
      }
      await fetchState();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteS3Object = async (key) => {
    await fetch(`/api/s3/object/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (inspectedObject && inspectedObject.key === key) {
      setInspectedObject(null);
    }
    await fetchState();
  };

  // Handler 3: Create Custom CloudWatch Alarm
  const handleCreateAlarm = async (e) => {
    e.preventDefault();
    if (!alarmName.trim() || alarmThreshold === '') return;
    setCreatingAlarm(true);
    try {
      const res = await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: alarmName.trim(),
          metric: alarmMetric,
          operator: alarmOperator,
          threshold: Number(alarmThreshold)
        })
      });
      if (res.ok) {
        setAlarmName('');
        setAlarmThreshold('');
        await fetchState();
      }
    } finally {
      setCreatingAlarm(false);
    }
  };

  const handleDeleteAlarm = async (id) => {
    await fetch(`/api/alarms/${id}`, { method: 'DELETE' });
    await fetchState();
  };

  // Handler 4: Trigger CloudFront Cache Invalidation
  const handleInvalidateCache = async (e) => {
    e.preventDefault();
    if (!invalidationPaths.trim()) return;
    setInvalidating(true);
    try {
      const res = await fetch('/api/cloudfront/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: invalidationPaths.trim() })
      });
      if (res.ok) {
        setInvalidationPaths('');
        await fetchState();
      }
    } finally {
      setInvalidating(false);
    }
  };

  const handleClearData = async (target) => {
    await fetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    if (target === 'probes') setSelectedProbe(null);
    await fetchState();
  };

  const activeProbe = selectedProbe || cloudState.probes[0] || null;
  const alarmCountInDanger = cloudState.alarms.filter((a) => a.state === 'ALARM').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Telemetry Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-medium border ${
                backendOnline
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {backendOnline ? 'Python Live Cloud Backend Connected (:8000)' : 'Backend Disconnected'}
            </span>
            <span className="text-slate-400 hidden md:inline">
              100% Real-Time User-Driven Execution • Zero Pre-loaded Sample Data
            </span>
          </div>
          <div className="flex items-center gap-4 font-mono text-slate-400">
            <span>Probes Logged: <strong className="text-amber-400">{cloudState.probes.length}</strong></span>
            <span>S3 Objects: <strong className="text-sky-400">{cloudState.s3.objectCount}</strong></span>
            <span>Active Alarms: <strong className={alarmCountInDanger > 0 ? 'text-rose-400' : 'text-emerald-400'}>{cloudState.alarms.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-slate-950/90 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Cloud className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight flex items-center gap-2">
                CloudPulse <span className="text-amber-400">Live Console</span>
              </div>
              <p className="text-xs text-slate-400">Real-Time URL Telemetry, S3 Object Storage & CloudFront/CloudWatch Engine</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <a href="#probe-section" className="hover:text-amber-400 transition-colors">1. URL Telemetry Probe</a>
            <a href="#s3-section" className="hover:text-amber-400 transition-colors">2. S3 File Manager</a>
            <a href="#cloudfront-alarms" className="hover:text-amber-400 transition-colors">3. CloudFront & Alarms</a>
            <a href="#live-logs" className="hover:text-amber-400 transition-colors">4. Backend Log Stream</a>
            <a href="#architecture" className="hover:text-amber-400 transition-colors">Architecture</a>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        {/* =====================================================================
            FEATURE 1: REAL-TIME URL NETWORK TELEMETRY PROBE -> CLOUDWATCH METRICS
           ===================================================================== */}
        <section id="probe-section" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Amazon CloudWatch Synthetics & Real-Time Network Probe
              </span>
              <h2 className="text-2xl font-bold text-white mt-1">
                1. Live URL Latency, TLS & Header Inspector
              </h2>
              <p className="text-sm text-slate-400">
                Enter any URL below. The Python backend opens a real socket to measure DNS lookup time, TCP handshake, TLS negotiation, TTFB, HTTP status code, and response headers, then logs the metrics to CloudWatch.
              </p>
            </div>
            {cloudState.probes.length > 0 && (
              <button
                onClick={() => handleClearData('probes')}
                className="text-xs text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1.5 rounded-lg cursor-pointer self-start"
              >
                Clear Probe History
              </button>
            )}
          </div>

          {/* URL Input Form */}
          <form onSubmit={handleRunProbe} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Globe className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Enter a URL to probe in real time (e.g., https://aws.amazon.com or https://github.com)"
                className="w-full pl-11 pr-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={probing || !urlInput.trim()}
              className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {probing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Measuring Live Socket...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> Measure & Log to CloudWatch
                </>
              )}
            </button>
          </form>

          {probeError && (
            <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs font-mono">
              Error: {probeError}
            </div>
          )}

          {/* Probe Output Area */}
          {cloudState.probes.length === 0 ? (
            <div className="p-10 rounded-2xl bg-slate-900/50 border border-dashed border-slate-800 text-center space-y-2">
              <Globe className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="text-sm font-medium text-slate-300">No URLs probed yet</div>
              <p className="text-xs text-slate-500">
                Type any domain or URL above and click &ldquo;Measure &amp; Log to CloudWatch&rdquo; to see live DNS, TCP, TLS, TTFB, status code, and HTTP response headers.
              </p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-12 gap-6">
              {/* Left: Detailed Breakdown of Selected Probe */}
              <div className="lg:col-span-7 space-y-4">
                {activeProbe && (
                  <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
                      <div>
                        <span className="text-xs font-mono text-slate-400 block">{activeProbe.timestamp}</span>
                        <h3 className="font-mono font-bold text-base text-amber-400 break-all">{activeProbe.url}</h3>
                      </div>
                      {activeProbe.error ? (
                        <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono text-xs font-bold">
                          PROBE ERROR
                        </span>
                      ) : (
                        <span
                          className={`px-3 py-1 rounded-full font-mono text-xs font-bold border ${
                            activeProbe.statusCode >= 200 && activeProbe.statusCode < 400
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}
                        >
                          HTTP {activeProbe.statusCode} {activeProbe.reason}
                        </span>
                      )}
                    </div>

                    {activeProbe.error ? (
                      <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs font-mono text-rose-300">
                        {activeProbe.error}
                      </div>
                    ) : (
                      <>
                        {/* 5 Real-Time Timing Metrics */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-[11px] text-slate-400 block">DNS Lookup</span>
                            <span className="text-lg font-bold font-mono text-sky-400">{activeProbe.dnsMs} ms</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-[11px] text-slate-400 block">TCP Connect</span>
                            <span className="text-lg font-bold font-mono text-emerald-400">{activeProbe.tcpMs} ms</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-[11px] text-slate-400 block">TLS Handshake</span>
                            <span className="text-lg font-bold font-mono text-purple-400">{activeProbe.tlsMs} ms</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-[11px] text-slate-400 block">TTFB Wait</span>
                            <span className="text-lg font-bold font-mono text-amber-400">{activeProbe.ttfbMs} ms</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 col-span-2 sm:col-span-1">
                            <span className="text-[11px] text-slate-400 block">Total Time</span>
                            <span className="text-lg font-bold font-mono text-white">{activeProbe.totalMs} ms</span>
                          </div>
                        </div>

                        {/* Connection & TLS Metadata */}
                        <div className="grid sm:grid-cols-3 gap-3 text-xs font-mono">
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block">Resolved IP</span>
                            <span className="text-slate-200">{activeProbe.resolvedIp}:{activeProbe.port}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block">TLS Protocol</span>
                            <span className="text-emerald-400">{activeProbe.tlsVersion || 'Plain HTTP'}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block">TLS Cipher</span>
                            <span className="text-slate-200 truncate block" title={activeProbe.tlsCipher}>
                              {activeProbe.tlsCipher || 'N/A'}
                            </span>
                          </div>
                        </div>

                        {/* Live Response Headers */}
                        <div>
                          <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                            Real-Time HTTP Response Headers ({Object.keys(activeProbe.headers || {}).length})
                          </h4>
                          <div className="max-h-52 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs space-y-1">
                            {Object.entries(activeProbe.headers || {}).map(([k, v]) => (
                              <div key={k} className="flex gap-2 border-b border-slate-900 pb-1">
                                <span className="text-amber-400 shrink-0">{k}:</span>
                                <span className="text-slate-300 break-all">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Right: CloudWatch Logged Probes History & Chart */}
              <div className="lg:col-span-5 rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col justify-between space-y-4">
                <div>
                  <h3 className="font-semibold text-white text-sm flex items-center justify-between">
                    <span>CloudWatch Logged Probe Metrics ({cloudState.probes.length})</span>
                    <span className="text-xs font-mono text-slate-400">Click row to inspect</span>
                  </h3>

                  <div className="mt-4 space-y-2 max-h-96 overflow-y-auto pr-1">
                    {cloudState.probes.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedProbe(p)}
                        className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          activeProbe && activeProbe.id === p.id
                            ? 'bg-amber-500/10 border-amber-500/50'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-white truncate">{p.url}</div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            DNS: {p.dnsMs}ms • TLS: {p.tlsMs}ms • TTFB: {p.ttfbMs}ms
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              p.statusCode >= 200 && p.statusCode < 400
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {p.error ? 'ERR' : `HTTP ${p.statusCode}`}
                          </span>
                          <div className="text-xs font-mono font-bold text-amber-400 mt-1">{p.totalMs} ms</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* =====================================================================
            FEATURE 2: INTERACTIVE S3 BUCKET FILE MANAGER
           ===================================================================== */}
        <section id="s3-section" className="space-y-6 pt-4 border-t border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" /> Amazon S3 Object Storage Engine
              </span>
              <h2 className="text-2xl font-bold text-white mt-1">
                2. Interactive S3 Bucket File Manager
              </h2>
              <p className="text-sm text-slate-400">
                Upload any file from your computer to the Python-backed S3 bucket (`s3://{cloudState.s3.bucketName}`), inspect real MD5 ETag hashes, MIME types, byte sizes, download objects, or delete them.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                id="s3-file-upload-input"
              />
              <label
                htmlFor="s3-file-upload-input"
                className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center gap-2 cursor-pointer transition-all shadow-lg shadow-sky-500/20"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading to S3...' : 'Upload Files to S3 Bucket'}
              </label>
            </div>
          </div>

          {/* S3 Bucket Summary Bar */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block">Target S3 Bucket URI</span>
              <span className="font-mono text-sm text-sky-400 font-semibold mt-1 block">
                s3://{cloudState.s3.bucketName}
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block">Live CloudWatch `NumberOfObjects`</span>
              <span className="font-mono text-xl text-white font-bold mt-1 block">
                {cloudState.s3.objectCount} object(s)
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block">Live CloudWatch `BucketSizeBytes`</span>
              <span className="font-mono text-xl text-emerald-400 font-bold mt-1 block">
                {formatBytes(cloudState.s3.totalSizeBytes)} ({cloudState.s3.totalSizeBytes.toLocaleString()} B)
              </span>
            </div>
          </div>

          {/* S3 Objects Table & Inspector */}
          {cloudState.s3.objects.length === 0 ? (
            <div className="p-10 rounded-2xl bg-slate-900/50 border border-dashed border-slate-800 text-center space-y-2">
              <Database className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="text-sm font-medium text-slate-300">S3 Bucket is currently empty (0 objects)</div>
              <p className="text-xs text-slate-500">
                Click &ldquo;Upload Files to S3 Bucket&rdquo; above to upload images, HTML, JSON, PDFs, or any file from your machine.
              </p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-mono">
                      <th className="py-3 px-4">Object Key</th>
                      <th className="py-3 px-4">MIME Type</th>
                      <th className="py-3 px-4">Size</th>
                      <th className="py-3 px-4">Last Modified</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono">
                    {cloudState.s3.objects.map((obj) => (
                      <tr key={obj.key} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-semibold text-white">{obj.key}</td>
                        <td className="py-3 px-4 text-sky-400">{obj.mimeType}</td>
                        <td className="py-3 px-4 text-slate-300">{formatBytes(obj.sizeBytes)}</td>
                        <td className="py-3 px-4 text-slate-400">{obj.lastModified}</td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => setInspectedObject(obj)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer inline-flex items-center gap-1"
                            title="Inspect Object Metadata"
                          >
                            <Eye className="w-3.5 h-3.5" /> Inspect
                          </button>
                          <a
                            href={`/api/s3/download/${encodeURIComponent(obj.key)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 inline-flex items-center gap-1"
                            title="View / Download Object"
                          >
                            <Download className="w-3.5 h-3.5" /> Open
                          </a>
                          <button
                            onClick={() => handleDeleteS3Object(obj.key)}
                            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 cursor-pointer inline-flex items-center gap-1"
                            title="Delete Object from S3"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Object Metadata Inspector Panel */}
              <div className="lg:col-span-4 rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
                <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-400" />
                  S3 Object Metadata Inspector
                </h3>
                {!inspectedObject ? (
                  <p className="text-xs text-slate-500">
                    Click &ldquo;Inspect&rdquo; on any uploaded S3 object to view its full S3 headers, MD5 ETag, and byte size.
                  </p>
                ) : (
                  <div className="space-y-2.5 text-xs font-mono bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-slate-500 block">S3 URI</span>
                      <span className="text-amber-400 break-all">
                        s3://{cloudState.s3.bucketName}/{inspectedObject.key}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Content-Type (MIME)</span>
                      <span className="text-sky-400">{inspectedObject.mimeType}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Content-Length</span>
                      <span className="text-white">
                        {inspectedObject.sizeBytes.toLocaleString()} bytes ({formatBytes(inspectedObject.sizeBytes)})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">ETag (MD5 Checksum)</span>
                      <span className="text-emerald-400 break-all">{inspectedObject.etag}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Storage Class</span>
                      <span className="text-slate-300">{inspectedObject.storageClass}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* =====================================================================
            FEATURE 3: CLOUDFRONT CACHE INVALIDATION & CUSTOM CLOUDWATCH ALARMS
           ===================================================================== */}
        <section id="cloudfront-alarms" className="space-y-6 pt-4 border-t border-slate-800">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> Edge Cache Purge & Custom CloudWatch Alarm Rules
            </span>
            <h2 className="text-2xl font-bold text-white mt-1">
              3. Live CloudFront Cache Invalidation &amp; Custom Alarm Creator
            </h2>
            <p className="text-sm text-slate-400">
              Create your own CloudWatch Alarm thresholds (evaluated automatically against your live URL probes and S3 uploads) or purge specific object paths from CloudFront edge caches.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* Left Column: Custom CloudWatch Alarm Creator */}
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5">
              <h3 className="font-semibold text-base text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Create Custom CloudWatch Alarm Rule
              </h3>

              <form onSubmit={handleCreateAlarm} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Alarm Name</label>
                  <input
                    type="text"
                    value={alarmName}
                    onChange={(e) => setAlarmName(e.target.value)}
                    placeholder="e.g., High-Total-Latency-Alert or S3-Storage-Quota"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Metric</label>
                    <select
                      value={alarmMetric}
                      onChange={(e) => setAlarmMetric(e.target.value)}
                      className="w-full px-2.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono"
                    >
                      <option value="TotalLatencyMs">TotalLatencyMs (Probe)</option>
                      <option value="DnsLookupMs">DnsLookupMs (Probe)</option>
                      <option value="TlsHandshakeMs">TlsHandshakeMs (Probe)</option>
                      <option value="TtfbMs">TtfbMs (Probe)</option>
                      <option value="HttpStatusCode">HttpStatusCode (Probe)</option>
                      <option value="S3BucketSizeBytes">S3BucketSizeBytes</option>
                      <option value="S3ObjectCount">S3ObjectCount</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Condition</label>
                    <select
                      value={alarmOperator}
                      onChange={(e) => setAlarmOperator(e.target.value)}
                      className="w-full px-2.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono"
                    >
                      <option value=">">&gt; (Greater than)</option>
                      <option value=">=">&gt;= (Greater or equal)</option>
                      <option value="<">&lt; (Less than)</option>
                      <option value="<=">&lt;= (Less or equal)</option>
                      <option value="==">== (Equal to)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Threshold Value</label>
                    <input
                      type="number"
                      step="any"
                      value={alarmThreshold}
                      onChange={(e) => setAlarmThreshold(e.target.value)}
                      placeholder="e.g., 150"
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creatingAlarm || !alarmName.trim() || alarmThreshold === ''}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" /> Create &amp; Evaluate CloudWatch Alarm
                </button>
              </form>

              {/* Active User-Created Alarms List */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                <div className="text-xs font-mono text-slate-400">
                  Your Configured Alarms ({cloudState.alarms.length})
                </div>
                {cloudState.alarms.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No alarms created yet. Create an alarm rule above (for example: <code className="text-slate-300">TotalLatencyMs &gt; 100</code>) and run a URL probe to watch it trigger!
                  </p>
                ) : (
                  cloudState.alarms.map((alarm) => (
                    <div
                      key={alarm.id}
                      className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                        alarm.state === 'ALARM'
                          ? 'bg-rose-950/40 border-rose-500/50'
                          : alarm.state === 'OK'
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                          {alarm.name}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              alarm.state === 'ALARM'
                                ? 'bg-rose-500 text-slate-950'
                                : alarm.state === 'OK'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {alarm.state}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 mt-1">
                          Rule: <span className="text-amber-300">{alarm.metric} {alarm.operator} {alarm.threshold}</span> • Current Value: <strong className="text-white">{alarm.currentValue}</strong>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteAlarm(alarm.id)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 cursor-pointer"
                        title="Delete Alarm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Live CloudFront Cache Invalidation */}
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5">
              <h3 className="font-semibold text-base text-white flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-sky-400" />
                Trigger CloudFront Edge Cache Invalidation
              </h3>

              <form onSubmit={handleInvalidateCache} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">
                    Object Paths to Purge (comma-separated, e.g. <code className="text-sky-300">/*</code> or <code className="text-sky-300">/index.html, /logo.png</code>)
                  </label>
                  <input
                    type="text"
                    value={invalidationPaths}
                    onChange={(e) => setInvalidationPaths(e.target.value)}
                    placeholder="Enter path pattern to invalidate (e.g., /*)"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={invalidating || !invalidationPaths.trim()}
                  className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Zap className="w-4 h-4" /> Purge CloudFront Edge Cache Now
                </button>
              </form>

              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                <div className="text-xs font-mono text-slate-400">
                  Invalidation Execution History ({cloudState.invalidations.length})
                </div>
                {cloudState.invalidations.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No cache invalidations executed yet. Enter a path like <code className="text-slate-300">/*</code> above to purge matching S3 objects from edge locations.
                  </p>
                ) : (
                  cloudState.invalidations.map((inv) => (
                    <div key={inv.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sky-400 font-bold">ID: {inv.id}</span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                          {inv.status}
                        </span>
                      </div>
                      <div className="text-slate-300">Paths: {inv.paths.join(', ')}</div>
                      <div className="text-slate-400 text-[11px]">
                        Purged {inv.matchedObjectsCount} matching S3 object(s) • {inv.createdAt}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            FEATURE 4: LIVE BACKEND LOG STREAM CONSOLE
           ===================================================================== */}
        <section id="live-logs" className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" /> Real-Time CloudWatch Log Group (`/aws/cloudpulse/operations`)
              </span>
              <h2 className="text-xl font-bold text-white mt-0.5">
                4. Live Python Backend Event &amp; Telemetry Log Stream
              </h2>
            </div>
            {cloudState.logs.length > 0 && (
              <button
                onClick={() => handleClearData('logs')}
                className="text-xs text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1.5 rounded-lg cursor-pointer"
              >
                Clear Logs
              </button>
            )}
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 font-mono text-xs max-h-72 overflow-y-auto space-y-1.5">
            {cloudState.logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">
                Waiting for user events... Probe a URL, upload a file to S3, create an alarm, or run a cache invalidation to watch live backend logs stream here.
              </div>
            ) : (
              cloudState.logs.map((log) => (
                <div key={log.id} className="flex flex-wrap items-start gap-2 py-1 border-b border-slate-800/60">
                  <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                      log.level === 'ALERT' || log.level === 'ERROR'
                        ? 'bg-rose-500/20 text-rose-300'
                        : log.level === 'WARN'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {log.service}
                  </span>
                  <span className="text-slate-200 break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* =====================================================================
            SECTION 5: AWS ARCHITECTURE EXPLANATION
           ===================================================================== */}
        <section id="architecture" className="space-y-6 pt-4 border-t border-slate-800">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
              AWS Architecture Reference
            </span>
            <h2 className="text-2xl font-bold text-white mt-1">
              How S3, CloudFront, CloudWatch &amp; the Python Telemetry Engine Work Together
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5 text-xs">
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-bold text-white text-sm flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-sky-400" /> 1. Amazon S3 Object Storage
              </div>
              <p className="text-slate-400 leading-relaxed">
                Stores static web assets and user-uploaded files with MD5 `ETag` integrity verification, MIME detection, and real-time `BucketSizeBytes` and `NumberOfObjects` tracking.
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-bold text-white text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400" /> 2. Amazon CloudFront CDN
              </div>
              <p className="text-slate-400 leading-relaxed">
                Delivers S3 objects globally over TLS 1.3 HTTPS using Origin Access Control (OAC) and supports instant path-based cache invalidation (`/*`) to purge stale edge objects.
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-bold text-white text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" /> 3. Amazon CloudWatch &amp; Synthetics
              </div>
              <p className="text-slate-400 leading-relaxed">
                Executes live socket probes to measure DNS, TCP, TLS handshake, and TTFB latencies, logs structured events, and evaluates user-defined metric alarms in real time.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-800 py-8 text-xs text-slate-400 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <strong className="text-white">CloudPulse AWS Live Console</strong> — React + Tailwind CSS Frontend &amp; Python Real-Time Cloud Backend
          </div>
          <div className="font-mono text-slate-500">
            Workspace: <code className="text-amber-400">~/workspace/projects/course/AWS</code>
          </div>
        </div>
      </footer>
    </div>
  );
}
