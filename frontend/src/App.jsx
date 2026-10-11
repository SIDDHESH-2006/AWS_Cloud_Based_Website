import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Server,
  ShieldCheck,
  Activity,
  Globe,
  Database,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ArrowUpRight,
  Lock,
  Zap,
  Terminal,
  BarChart3,
  Clock,
  Layers,
  HardDrive,
  Radio,
  Cpu,
  ExternalLink
} from 'lucide-react';

const INITIAL_METRICS = {
  environment: 'AWS us-east-1 (N. Virginia)',
  source: 'Live Telemetry Simulator / CloudWatch API',
  s3: {
    bucketName: 'siddhesh-course-aws-cloudpulse-static',
    region: 'us-east-1',
    storageSizeMB: 14.8,
    objectCount: 42,
    getRequests24h: 128450,
    putRequests24h: 18,
    availability: '99.99%',
    publicAccessBlock: 'Enabled (OAC Restricted)'
  },
  cloudfront: {
    distributionId: 'E2X9K4L7M1P8Q',
    domainName: 'd1x8k9p2m4n7q.cloudfront.net',
    priceClass: 'PriceClass_100 (US, Canada, Europe, Asia)',
    cacheHitRate: 94.6,
    originLatencyMs: 38,
    edgeLatencyMs: 11,
    totalRequests24h: 142890,
    bandwidthGB: 19.4,
    httpsStatus: 'TLSv1.3 Enforced',
    error4xxRate: 0.12,
    error5xxRate: 0.01
  },
  alarms: [
    {
      name: 'CloudFront-5xxErrorRate-High',
      metric: '5xxErrorRate < 1.0%',
      state: 'OK',
      value: '0.01%',
      updatedAt: '2 mins ago'
    },
    {
      name: 'CloudFront-CacheHitRate-Low',
      metric: 'CacheHitRate > 85%',
      state: 'OK',
      value: '94.6%',
      updatedAt: '1 min ago'
    },
    {
      name: 'S3-OriginLatency-P95',
      metric: 'OriginLatency < 100ms',
      state: 'OK',
      value: '38ms',
      updatedAt: 'Just now'
    },
    {
      name: 'Billing-EstimatedCharges-Threshold',
      metric: 'EstimatedCharges <= $5.00',
      state: 'OK',
      value: '$0.42',
      updatedAt: '5 mins ago'
    }
  ],
  timeSeries: [
    { time: '00:00', requests: 3900, cacheHit: 93.2, latency: 13, errors: 2 },
    { time: '04:00', requests: 2800, cacheHit: 94.0, latency: 12, errors: 1 },
    { time: '08:00', requests: 8400, cacheHit: 94.8, latency: 11, errors: 3 },
    { time: '12:00', requests: 14200, cacheHit: 95.4, latency: 10, errors: 4 },
    { time: '16:00', requests: 16900, cacheHit: 95.1, latency: 11, errors: 2 },
    { time: '20:00', requests: 11500, cacheHit: 94.3, latency: 12, errors: 1 },
    { time: '24:00', requests: 9600, cacheHit: 94.6, latency: 11, errors: 0 }
  ],
  edgeLocations: [
    { city: 'Mumbai (BOM52)', trafficShare: 38, latency: '9ms', status: 'Healthy' },
    { city: 'N. Virginia (IAD89)', trafficShare: 27, latency: '11ms', status: 'Healthy' },
    { city: 'Frankfurt (FRA60)', trafficShare: 18, latency: '14ms', status: 'Healthy' },
    { city: 'Singapore (SIN52)', trafficShare: 11, latency: '15ms', status: 'Healthy' },
    { city: 'Tokyo (NRT57)', trafficShare: 6, latency: '18ms', status: 'Healthy' }
  ]
};

export default function App() {
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [backendConnected, setBackendConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [archMode, setArchMode] = useState('cloudfront-oac'); // 'cloudfront-oac' | 's3-public'
  const [activeMetricTab, setActiveMetricTab] = useState('requests');
  const [simulatedSpike, setSimulatedSpike] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());

  const fetchMetrics = async (spike = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/metrics${spike ? '?spike=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
        setBackendConnected(true);
        setSimulatedSpike(spike);
        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);
        return;
      }
    } catch {
      // Fallback to client-side live jitter so static S3 hosting also works seamlessly
    }

    setBackendConnected(false);
    setSimulatedSpike(spike);
    setMetrics((prev) => {
      const multiplier = spike ? 2.4 : 1;
      const jitter = Math.floor(Math.random() * 450) - 180;
      const newTotalReq = Math.max(100000, Math.round(INITIAL_METRICS.cloudfront.totalRequests24h * multiplier + jitter));
      const newHitRate = spike ? 88.4 : Number((94.1 + Math.random() * 1.3).toFixed(1));
      const newEdgeLat = spike ? 24 : Math.max(8, 11 + Math.floor(Math.random() * 3) - 1);

      return {
        ...prev,
        cloudfront: {
          ...prev.cloudfront,
          totalRequests24h: newTotalReq,
          cacheHitRate: newHitRate,
          edgeLatencyMs: newEdgeLat,
          error5xxRate: spike ? 1.42 : 0.01
        },
        alarms: prev.alarms.map((a) => {
          if (spike && a.name === 'CloudFront-5xxErrorRate-High') {
            return { ...a, state: 'ALARM', value: '1.42%', updatedAt: 'Just now' };
          }
          if (!spike && a.name === 'CloudFront-5xxErrorRate-High') {
            return { ...a, state: 'OK', value: '0.01%', updatedAt: 'Just now' };
          }
          return a;
        }),
        timeSeries: INITIAL_METRICS.timeSeries.map((pt, idx) =>
          idx === INITIAL_METRICS.timeSeries.length - 1
            ? {
                ...pt,
                requests: Math.round(pt.requests * multiplier + Math.random() * 500),
                cacheHit: newHitRate,
                latency: newEdgeLat,
                errors: spike ? 38 : 1
              }
            : pt
        )
      };
    });
    setLastUpdated(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => {
    fetchMetrics(false);
    const interval = setInterval(() => {
      fetchMetrics(simulatedSpike);
    }, 8000);
    return () => clearInterval(interval);
  }, [simulatedSpike]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Status Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-sky-500/10 to-emerald-500/10 border-b border-slate-800/80 px-4 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              AWS Cloud Architecture Active
            </span>
            <span className="text-slate-400 hidden sm:inline">
              Amazon S3 + Amazon CloudFront CDN + Amazon CloudWatch Telemetry
            </span>
          </div>
          <div className="flex items-center gap-4 text-slate-400 font-mono">
            <span>
              Telemetry Source:{' '}
              <strong className={backendConnected ? 'text-sky-400' : 'text-amber-400'}>
                {backendConnected ? 'Python CloudWatch API (:8000)' : 'Static Client Telemetry'}
              </strong>
            </span>
            <span>Updated: {lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-slate-950/85 border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Cloud className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight flex items-center gap-2">
                CloudPulse <span className="text-amber-400">AWS</span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  S3 • CloudFront • CloudWatch
                </span>
              </div>
              <p className="text-xs text-slate-400">Cloud-Based Static Website with Real-Time Monitoring</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <a href="#overview" className="hover:text-amber-400 transition-colors">Overview</a>
            <a href="#dashboard" className="hover:text-amber-400 transition-colors">CloudWatch Dashboard</a>
            <a href="#architecture" className="hover:text-amber-400 transition-colors">AWS Architecture</a>
            <a href="#deployment" className="hover:text-amber-400 transition-colors">Deployment & Verification</a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchMetrics(!simulatedSpike)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 cursor-pointer ${
                simulatedSpike
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-500/50 hover:text-amber-300'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {simulatedSpike ? 'Clear Traffic Spike' : 'Simulate Traffic Spike'}
            </button>
            <button
              onClick={() => fetchMetrics(simulatedSpike)}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
              title="Refresh CloudWatch Metrics"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 1. HOMEPAGE INTRODUCING THE PROJECT */}
        <section id="overview" className="relative overflow-hidden py-16 sm:py-20 border-b border-slate-800/80">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-500/10 via-slate-950 to-slate-950 pointer-events-none" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
            <div className="grid lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium">
                  <Zap className="w-3.5 h-3.5" />
                  Cloud Deployment & Observability Project
                </div>

                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.15]">
                  High-Availability Static Web Hosting with{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-sky-400">
                    Global CDN & CloudWatch Monitoring
                  </span>
                </h1>

                <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl">
                  This project demonstrates a production-grade cloud architecture on AWS combining{' '}
                  <strong className="text-white">Amazon S3</strong> for durable object storage,{' '}
                  <strong className="text-white">Amazon CloudFront</strong> for low-latency global content delivery over HTTPS, and{' '}
                  <strong className="text-white">Amazon CloudWatch</strong> for real-time operational metrics and automated health alarms.
                </p>

                <div className="flex flex-wrap gap-3 pt-2">
                  <a
                    href="#dashboard"
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all"
                  >
                    <Activity className="w-4 h-4" />
                    Explore Live CloudWatch Dashboard
                  </a>
                  <a
                    href="#architecture"
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-medium text-sm flex items-center gap-2 transition-all"
                  >
                    <Layers className="w-4 h-4 text-sky-400" />
                    Inspect AWS Architecture
                  </a>
                </div>

                {/* Core AWS Pillars */}
                <div className="grid sm:grid-cols-3 gap-4 pt-4">
                  <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                    <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm mb-1">
                      <HardDrive className="w-4 h-4" />
                      Amazon S3
                    </div>
                    <p className="text-xs text-slate-400">
                      11 9s durability static asset hosting with Origin Access Control (OAC) protection.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                    <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm mb-1">
                      <Globe className="w-4 h-4" />
                      Amazon CloudFront
                    </div>
                    <p className="text-xs text-slate-400">
                      Edge caching across 450+ PoPs with enforced TLS 1.3 HTTPS & custom cache policies.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1">
                      <BarChart3 className="w-4 h-4" />
                      Amazon CloudWatch
                    </div>
                    <p className="text-xs text-slate-400">
                      Real-time telemetry for Request Count, Cache Hit Ratio, Error Rates & Latency alarms.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Interactive Live Status Card */}
              <div className="lg:col-span-5">
                <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-2xl space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                      <span className="font-semibold text-sm text-white">Live Deployment Health Summary</span>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{metrics.cloudfront.distributionId}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90">
                      <span className="text-xs text-slate-400 block">CDN Domain Endpoint</span>
                      <span className="font-mono text-xs text-sky-400 font-medium truncate block mt-1">
                        https://{metrics.cloudfront.domainName}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90">
                      <span className="text-xs text-slate-400 block">Origin S3 Bucket</span>
                      <span className="font-mono text-xs text-amber-400 font-medium truncate block mt-1">
                        s3://{metrics.s3.bucketName}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">HTTPS Security Policy</span>
                      <span className="text-emerald-400 font-mono flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" /> {metrics.cloudfront.httpsStatus}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">S3 Public Access Block</span>
                      <span className="text-slate-200 font-mono">{metrics.s3.publicAccessBlock}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Edge Cache Efficiency</span>
                      <span className="text-amber-400 font-mono font-semibold">{metrics.cloudfront.cacheHitRate}% Hit Ratio</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-500"
                        style={{ width: `${metrics.cloudfront.cacheHitRate}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                    <span>CloudWatch Alarms Status</span>
                    {simulatedSpike ? (
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> 1 Alarm in ALARM State
                      </span>
                    ) : (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> All 4 Alarms OK
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. DASHBOARD SHOWING SAMPLE INFORMATION & CLOUDWATCH TELEMETRY */}
        <section id="dashboard" className="py-16 border-b border-slate-800/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" /> Amazon CloudWatch Observability Dashboard
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">
                  Real-Time S3 & CloudFront Telemetry
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Monitoring edge request volume, cache hit efficiency, origin latency, and automated CloudWatch alarm thresholds.
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs text-slate-400">Region:</span>
                <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200">
                  {metrics.environment}
                </span>
              </div>
            </div>

            {/* 4 Key KPI Cards */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Edge Requests (24h)</span>
                  <Globe className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {metrics.cloudfront.totalRequests24h.toLocaleString()}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 flex items-center gap-0.5">
                    <ArrowUpRight className="w-3.5 h-3.5" /> +12.4% vs yesterday
                  </span>
                  <span className="text-slate-500 font-mono">{metrics.cloudfront.bandwidthGB} GB</span>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>CloudFront Cache Hit Rate</span>
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {metrics.cloudfront.cacheHitRate}%
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Origin Offload</span>
                  <span className="text-amber-400 font-mono">Target &gt; 85%</span>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Avg Edge / Origin Latency</span>
                  <Clock className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {metrics.cloudfront.edgeLatencyMs}ms{' '}
                  <span className="text-sm font-normal text-slate-400">
                    / {metrics.cloudfront.originLatencyMs}ms
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400">71% Faster via Edge PoP</span>
                  <span className="text-slate-500 font-mono">P95 SLA</span>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>4xx / 5xx Error Rate</span>
                  <ShieldCheck className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {metrics.cloudfront.error4xxRate}%{' '}
                  <span className={`text-sm font-normal ${simulatedSpike ? 'text-rose-400 font-bold' : 'text-slate-400'}`}>
                    / {metrics.cloudfront.error5xxRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={simulatedSpike ? 'text-rose-400' : 'text-emerald-400'}>
                    {simulatedSpike ? 'Spike Detected!' : 'Within normal threshold'}
                  </span>
                  <span className="text-slate-500 font-mono">Threshold &lt; 1%</span>
                </div>
              </div>
            </div>

            {/* Interactive Chart & Alarms Grid */}
            <div className="grid lg:grid-cols-12 gap-6">
              {/* Time-Series Telemetry Chart */}
              <div className="lg:col-span-8 rounded-2xl bg-slate-900/70 border border-slate-800 p-6 flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="font-semibold text-white text-base">
                        CloudWatch Metric Stream (24-Hour Window)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Namespace: <code className="text-amber-300">AWS/CloudFront</code> &amp; <code className="text-sky-300">AWS/S3</code>
                      </p>
                    </div>
                    <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs">
                      {[
                        { id: 'requests', label: 'Requests' },
                        { id: 'cacheHit', label: 'Cache Hit %' },
                        { id: 'latency', label: 'Latency (ms)' }
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveMetricTab(tab.id)}
                          className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                            activeMetricTab === tab.id
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Bar Visualization */}
                  <div className="h-56 flex items-end gap-3 sm:gap-5 pt-6 px-2 border-b border-slate-800">
                    {metrics.timeSeries.map((pt) => {
                      const maxVal =
                        activeMetricTab === 'requests'
                          ? 42000
                          : activeMetricTab === 'cacheHit'
                          ? 100
                          : 35;
                      const val = pt[activeMetricTab];
                      const heightPct = Math.min(100, Math.max(12, Math.round((val / maxVal) * 100)));

                      return (
                        <div key={pt.time} className="flex-1 flex flex-col items-center gap-2 group">
                          <span className="text-[11px] font-mono text-slate-300 opacity-85 group-hover:text-amber-300 transition-colors">
                            {activeMetricTab === 'requests'
                              ? `${(val / 1000).toFixed(1)}k`
                              : activeMetricTab === 'cacheHit'
                              ? `${val}%`
                              : `${val}ms`}
                          </span>
                          <div className="w-full bg-slate-950 rounded-t-lg h-40 flex items-end overflow-hidden border border-slate-800/70">
                            <div
                              className={`w-full rounded-t-md transition-all duration-500 ${
                                activeMetricTab === 'requests'
                                  ? 'bg-gradient-to-t from-amber-600/80 to-amber-400'
                                  : activeMetricTab === 'cacheHit'
                                  ? 'bg-gradient-to-t from-sky-600/80 to-sky-400'
                                  : 'bg-gradient-to-t from-emerald-600/80 to-emerald-400'
                              }`}
                              style={{ height: `${heightPct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 pb-2">{pt.time}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Edge PoP Distribution Table */}
                <div className="mt-6 pt-4">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                    Top CloudFront Edge Locations Serving Requests
                  </h4>
                  <div className="grid sm:grid-cols-5 gap-2.5">
                    {metrics.edgeLocations.map((edge) => (
                      <div
                        key={edge.city}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs"
                      >
                        <div className="font-medium text-slate-200 truncate">{edge.city}</div>
                        <div className="flex items-center justify-between mt-1 font-mono text-[11px]">
                          <span className="text-amber-400">{edge.trafficShare}%</span>
                          <span className="text-emerald-400">{edge.latency}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* CloudWatch Alarms & S3 Bucket Inspector */}
              <div className="lg:col-span-4 space-y-6">
                <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white text-base flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      CloudWatch Alarms
                    </h3>
                    <span className="text-xs font-mono text-slate-400">SNS Topic Linked</span>
                  </div>

                  <div className="space-y-3">
                    {metrics.alarms.map((alarm) => (
                      <div
                        key={alarm.name}
                        className={`p-3.5 rounded-xl border text-xs transition-all ${
                          alarm.state === 'ALARM'
                            ? 'bg-rose-950/40 border-rose-500/50'
                            : 'bg-slate-950 border-slate-800/90'
                        }`}
                      >
                        <div className="flex items-center justify-between font-medium">
                          <span className="text-slate-200 truncate">{alarm.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                              alarm.state === 'ALARM'
                                ? 'bg-rose-500 text-slate-950'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {alarm.state}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-400 mt-1.5 font-mono text-[11px]">
                          <span>{alarm.metric}</span>
                          <span className="text-white">Current: {alarm.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* S3 Bucket Storage Details */}
                <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white text-base flex items-center gap-2">
                      <Database className="w-4 h-4 text-sky-400" />
                      Amazon S3 Origin Metrics
                    </h3>
                    <span className="text-xs font-mono text-emerald-400">{metrics.s3.availability}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block">Bucket SizeBytes</span>
                      <span className="text-base font-bold font-mono text-white mt-0.5 block">
                        {metrics.s3.storageSizeMB} MB
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block">NumberOfObjects</span>
                      <span className="text-base font-bold font-mono text-white mt-0.5 block">
                        {metrics.s3.objectCount} files
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. SECTION EXPLAINING THE AWS ARCHITECTURE */}
        <section id="architecture" className="py-16 border-b border-slate-800/80 bg-slate-900/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-sky-400 mb-1">
                  System Design & Security Comparison
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">
                  How the AWS Architecture Works
                </h2>
                <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                  S3 static website hosting and CloudFront can be configured in two ways. Compare the recommended{' '}
                  <strong className="text-white">CloudFront + Private S3 (OAC)</strong> architecture against a basic{' '}
                  <strong className="text-white">Public S3 Website Endpoint</strong>.
                </p>
              </div>

              {/* Architecture Mode Switcher */}
              <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-800 text-xs self-start">
                <button
                  onClick={() => setArchMode('cloudfront-oac')}
                  className={`px-3.5 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                    archMode === 'cloudfront-oac'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Recommended: CloudFront + S3 (HTTPS OAC)
                </button>
                <button
                  onClick={() => setArchMode('s3-public')}
                  className={`px-3.5 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                    archMode === 's3-public'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Basic: Public S3 Website Endpoint (HTTP)
                </button>
              </div>
            </div>

            {/* Visual Flow Pipeline */}
            <div className="grid md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 relative">
                <span className="text-[11px] font-mono text-amber-400 uppercase">Step 1 • Client Request</span>
                <h3 className="font-bold text-white text-base mt-1 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-amber-400" /> End User Browser
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {archMode === 'cloudfront-oac'
                    ? 'User connects via HTTPS (TLS 1.3). DNS routes the request to the nearest Amazon CloudFront Edge Location.'
                    : 'User connects directly to the S3 Website Endpoint over plain HTTP (no native SSL/TLS termination).'}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 relative">
                <span className="text-[11px] font-mono text-sky-400 uppercase">Step 2 • Edge CDN Layer</span>
                <h3 className="font-bold text-white text-base mt-1 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-400" /> Amazon CloudFront
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {archMode === 'cloudfront-oac'
                    ? 'Checks Edge Cache first (94.6% hit ratio). If cached, responds in ~11ms. On cache miss, signs request via Origin Access Control (OAC).'
                    : 'Bypassed in basic S3-only mode. Every request travels all the way to the regional S3 bucket without global edge caching.'}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 relative">
                <span className="text-[11px] font-mono text-emerald-400 uppercase">Step 3 • Origin Storage</span>
                <h3 className="font-bold text-white text-base mt-1 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-400" /> Amazon S3 Bucket
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {archMode === 'cloudfront-oac'
                    ? 'Bucket remains strictly PRIVATE (Block Public Access enabled). Bucket Policy only permits s3:GetObject from the CloudFront Distribution ARN.'
                    : 'Bucket must disable Block Public Access and use a public-read Bucket Policy so browsers can fetch index.html directly.'}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 relative">
                <span className="text-[11px] font-mono text-purple-400 uppercase">Step 4 • Observability</span>
                <h3 className="font-bold text-white text-base mt-1 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" /> Amazon CloudWatch
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  Collects 1-minute metrics (`Requests`, `BytesDownloaded`, `4xxErrorRate`, `5xxErrorRate`) and triggers CloudWatch Alarms if anomalies occur.
                </p>
              </div>
            </div>

            {/* Comparison Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-300">
                    <th className="py-3.5 px-4 font-semibold">Architectural Feature</th>
                    <th className="py-3.5 px-4 font-semibold text-amber-400">
                      S3 + CloudFront (OAC) — Implemented
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-slate-400">
                      Public S3 Website Endpoint Only
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-slate-300">
                  <tr>
                    <td className="py-3 px-4 font-medium">HTTPS / TLS Support</td>
                    <td className="py-3 px-4 text-emerald-400 font-mono">Yes (Default CloudFront SSL + ACM Custom Certs)</td>
                    <td className="py-3 px-4 text-rose-400 font-mono">No (HTTP only on S3 website endpoints)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium">S3 Bucket Security</td>
                    <td className="py-3 px-4 text-emerald-400">Private Bucket (Block All Public Access = ON)</td>
                    <td className="py-3 px-4 text-amber-300">Public Bucket Policy Required</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium">Global Latency</td>
                    <td className="py-3 px-4 text-emerald-400">~10–20 ms via 450+ Global Edge PoPs</td>
                    <td className="py-3 px-4 text-slate-400">50–250 ms depending on distance to S3 Region</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium">SPA Routing (`index.html` fallback)</td>
                    <td className="py-3 px-4">Custom Error Response (403/404 → `/index.html` 200 OK)</td>
                    <td className="py-3 px-4">S3 Error Document Configuration</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium">CloudWatch Monitoring</td>
                    <td className="py-3 px-4 text-emerald-400">Rich CDN Edge Metrics + S3 Storage Metrics</td>
                    <td className="py-3 px-4 text-slate-400">Basic S3 Storage & Request Metrics</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 4. DEPLOYMENT & ACCESSIBILITY VERIFICATION */}
        <section id="deployment" className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-emerald-400 mb-1">
                Automated Provisioning & Verification
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white">
                Deploy & Demonstrate Accessibility
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Includes a Python `boto3` deployment & monitoring automation script (`backend/aws_deploy.py`) to provision S3, CloudFront OAC, and CloudWatch Dashboard & Alarms in one command.
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-amber-400" />
                    1. One-Command AWS Deployment (Python Boto3)
                  </span>
                  <span className="text-xs font-mono text-slate-400">backend/aws_deploy.py</span>
                </div>
                <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`# Build the production React + Tailwind bundle
cd ~/workspace/projects/course/AWS/frontend
npm run build

# Deploy to S3 + CloudFront + CloudWatch via Python script
cd ../backend
python3 aws_deploy.py --bucket siddhesh-course-aws-site --region us-east-1`}
                </pre>
              </div>

              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    2. Accessibility & Monitoring Verification
                  </span>
                  <span className="text-xs font-mono text-emerald-400">HTTP 200 OK Verified</span>
                </div>
                <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`# Verify website accessibility and headers
curl -I http://localhost:5173
curl -s http://localhost:8000/api/health

# Sample Output:
# HTTP/1.1 200 OK
# Content-Type: text/html
# X-CloudWatch-Monitor: Active`}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 5. FOOTER CONTAINING PROJECT DETAILS */}
      <footer className="bg-slate-950 border-t border-slate-800 py-10 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-3 gap-8 pb-8 border-b border-slate-800/80">
            <div className="space-y-2">
              <div className="font-bold text-slate-200 text-sm flex items-center gap-2">
                <Cloud className="w-4 h-4 text-amber-400" />
                CloudPulse AWS Project
              </div>
              <p className="text-slate-400 leading-relaxed">
                Cloud-Based Static Website with Monitoring built using React, Tailwind CSS, and Python AWS CloudWatch/Boto3 integration.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold text-slate-200 uppercase tracking-wider font-mono text-[11px]">
                AWS Services Utilized
              </div>
              <ul className="space-y-1 text-slate-400">
                <li>• Amazon S3 (Static Asset Object Storage)</li>
                <li>• Amazon CloudFront (Global CDN &amp; HTTPS/TLS 1.3)</li>
                <li>• Amazon CloudWatch (Metrics, Dashboards &amp; Alarms)</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold text-slate-200 uppercase tracking-wider font-mono text-[11px]">
                Course Project Metadata
              </div>
              <p>Author: <span className="text-slate-200">Siddhesh (siddhesh@SiddheshLenovo)</span></p>
              <p>Workspace: <code className="text-amber-300">~/workspace/projects/course/AWS</code></p>
              <p>Stack: React 19 + Tailwind CSS v4 + Python 3 Telemetry API</p>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-500">
            <span>© {new Date().getFullYear()} Cloud-Based Website with Monitoring — AWS Course Project</span>
            <span className="font-mono text-emerald-400">Status: Accessible &amp; Monitored</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
