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
  Key,
  ShieldCheck,
  Play,
  Copy,
  ExternalLink,
  Radio,
  Server
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

const PRESET_COMMANDS = [
  { label: 'Check AWS Caller Identity', cmd: 'aws sts get-caller-identity' },
  { label: 'List S3 Buckets in Mumbai', cmd: 'aws s3 ls' },
  { label: 'Build Frontend Application', cmd: 'cd frontend && npm run build' },
  { label: 'Sync Dist to S3', cmd: 'aws s3 sync frontend/dist/ s3://$AWS_BUCKET/ --region ap-south-1' },
  { label: 'List CloudFront Distributions', cmd: "aws cloudfront list-distributions --query 'DistributionList.Items[].{Id:Id,Domain:DomainName,Status:Status}' --output table" },
  { label: 'Describe CloudWatch Alarms', cmd: 'aws cloudwatch describe-alarms --region ap-south-1' },
  { label: 'Send Sample CloudWatch Metric', cmd: "aws cloudwatch put-metric-data --namespace CloudPulse --metric-data '[{\"MetricName\":\"TotalLatencyMs\",\"Value\":120,\"Unit\":\"Milliseconds\"}]' --region ap-south-1" }
];

export default function App() {
  const [cloudState, setCloudState] = useState({
    aws: { authenticated: false, region: 'ap-south-1', defaultBucket: '', availableBuckets: [], cloudfrontDistributions: [] },
    s3: { bucketName: 'cloudpulse-frontend-live-bucket', region: 'ap-south-1', objectCount: 0, totalSizeBytes: 0, objects: [] },
    probes: [],
    alarms: [],
    invalidations: [],
    commandHistory: [],
    logs: []
  });
  const [backendOnline, setBackendOnline] = useState(false);

  // AWS Authentication Form State
  const [authMode, setAuthMode] = useState('sso'); // 'sso' | 'keys'
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('ap-south-1');
  const [ssoLoginUrl, setSsoLoginUrl] = useState('');
  const [ssoAuthCode, setSsoAuthCode] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [submittingCode, setSubmittingCode] = useState(false);

  // Terminal Runner State
  const [terminalCmd, setTerminalCmd] = useState('');
  const [runningCmd, setRunningCmd] = useState(false);

  // Live URL Probe Form State
  const [urlInput, setUrlInput] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [selectedProbe, setSelectedProbe] = useState(null);

  // S3 Bucket State
  const [uploading, setUploading] = useState(false);
  const [inspectedObject, setInspectedObject] = useState(null);
  const [newBucketName, setNewBucketName] = useState('');
  const [creatingBucket, setCreatingBucket] = useState(false);
  const fileInputRef = useRef(null);

  // CloudWatch Alarms & CloudFront Invalidation
  const [alarmName, setAlarmName] = useState('');
  const [alarmMetric, setAlarmMetric] = useState('TotalLatencyMs');
  const [alarmOperator, setAlarmOperator] = useState('>');
  const [alarmThreshold, setAlarmThreshold] = useState('');
  const [creatingAlarm, setCreatingAlarm] = useState(false);

  const [invalidationPaths, setInvalidationPaths] = useState('');
  const [invalidationDistId, setInvalidationDistId] = useState('');
  const [invalidating, setInvalidating] = useState(false);

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
    const timer = setInterval(fetchState, 3500);
    return () => clearInterval(timer);
  }, []);

  // 1. AWS SSO Browser Auth Trigger
  const handleStartSsoLogin = async () => {
    setSsoLoading(true);
    setSsoLoginUrl('');
    setSsoAuthCode('');
    try {
      const res = await fetch('/api/aws/login-start', { method: 'POST' });
      const data = await res.json();
      if (data.authUrl) {
        setSsoLoginUrl(data.authUrl);
      }
      await fetchState();
    } finally {
      setSsoLoading(false);
    }
  };

  // 1B. Submit Authorization Code from Browser
  const handleSubmitAuthCode = async (e) => {
    e.preventDefault();
    if (!ssoAuthCode.trim()) return;
    setSubmittingCode(true);
    try {
      const res = await fetch('/api/aws/login-submit-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: ssoAuthCode.trim() })
      });
      const data = await res.json();
      if (data.ok) {
        setSsoLoginUrl('');
        setSsoAuthCode('');
        await fetchState();
      } else {
        alert(data.error || 'Failed to submit authorization code');
      }
    } finally {
      setSubmittingCode(false);
    }
  };

  // 1C. AWS Sign Out / Logout
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    if (!window.confirm('Are you sure you want to sign out of AWS?')) return;
    setSigningOut(true);
    try {
      const res = await fetch('/api/aws/logout', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setSsoLoginUrl('');
        setSsoAuthCode('');
        await fetchState();
      }
    } finally {
      setSigningOut(false);
    }
  };

  // 2. AWS Static Key Auth
  const handleConfigureKeys = async (e) => {
    e.preventDefault();
    if (!accessKey.trim() || !secretKey.trim()) return;
    try {
      const res = await fetch('/api/aws/configure-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey, secretKey, region: awsRegion })
      });
      if (res.ok) {
        setAccessKey('');
        setSecretKey('');
        await fetchState();
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // 3. Run Direct Terminal Command
  const handleRunCommand = async (commandToRun) => {
    const cmd = commandToRun || terminalCmd;
    if (!cmd.trim()) return;
    setRunningCmd(true);
    try {
      await fetch('/api/aws/run-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.trim() })
      });
      setTerminalCmd('');
      await fetchState();
    } finally {
      setRunningCmd(false);
    }
  };

  // 4. Create S3 Bucket on AWS
  const handleCreateBucket = async (e) => {
    e.preventDefault();
    if (!newBucketName.trim()) return;
    setCreatingBucket(true);
    try {
      const res = await fetch('/api/s3/create-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketName: newBucketName.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to create bucket');
      } else {
        setNewBucketName('');
        await fetchState();
      }
    } finally {
      setCreatingBucket(false);
    }
  };

  // 5. Select Active S3 Bucket
  const handleSelectBucket = async (bucketName) => {
    await fetch('/api/aws/set-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketName })
    });
    await fetchState();
  };

  // 6. Live URL Probe
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

  // 7. S3 File Upload
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
            contentBase64: base64Content,
            bucketName: cloudState.s3.bucketName
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
    if (inspectedObject && inspectedObject.key === key) setInspectedObject(null);
    await fetchState();
  };

  // 8. Create CloudWatch Alarm
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

  // 9. Invalidate CloudFront
  const handleInvalidateCache = async (e) => {
    e.preventDefault();
    if (!invalidationPaths.trim()) return;
    setInvalidating(true);
    try {
      await fetch('/api/cloudfront/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: invalidationPaths.trim(),
          distributionId: invalidationDistId.trim()
        })
      });
      setInvalidationPaths('');
      await fetchState();
    } finally {
      setInvalidating(false);
    }
  };

  const activeProbe = selectedProbe || cloudState.probes[0] || null;
  const isAwsAuth = cloudState.aws?.authenticated;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top AWS Connection & Session Ribbon */}
      <div className={`px-4 py-2.5 text-xs border-b ${
        isAwsAuth
          ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
          : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
      }`}>
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full ${isAwsAuth ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="font-semibold">
              {isAwsAuth ? 'AWS Cloud Connected' : 'AWS Cloud Offline / Session Expired'}
            </span>
            {isAwsAuth && (
              <span className="font-mono text-[11px] text-slate-300 hidden md:inline">
                ARN: <span className="text-emerald-300">{cloudState.aws?.arn}</span> • Region: <span className="text-sky-300">{cloudState.aws?.region}</span>
              </span>
            )}
            {!isAwsAuth && (
              <span className="text-slate-400 hidden md:inline">
                (Sign in below to link Amazon S3, CloudWatch, and CloudFront directly to your AWS Account)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isAwsAuth ? (
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-medium transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                {signingOut ? 'Signing out...' : 'Sign out of AWS'}
              </button>
            ) : (
              <a
                href="#aws-auth-section"
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-amber-400 text-slate-200 font-medium transition-colors"
              >
                Sign in to AWS
              </a>
            )}
            <span className="text-slate-500 font-mono">Backend: {backendOnline ? 'Online (:8000)' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-slate-950/90 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Cloud className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight flex items-center gap-2">
                CloudPulse <span className="text-amber-400">AWS Console</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {cloudState.aws?.region || 'ap-south-1'}
                </span>
              </div>
              <p className="text-xs text-slate-400">Interactive Cloud Operations, Terminal Runner &amp; Live Observability</p>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-5 text-xs font-medium text-slate-300">
            <a href="#aws-auth-section" className="hover:text-amber-400 transition-colors">1. AWS Sign-in</a>
            <a href="#terminal-section" className="hover:text-amber-400 transition-colors">2. AWS Terminal Runner</a>
            <a href="#probe-section" className="hover:text-amber-400 transition-colors">3. Synthetics URL Probe</a>
            <a href="#s3-section" className="hover:text-amber-400 transition-colors">4. S3 Bucket Manager</a>
            <a href="#alarms-section" className="hover:text-amber-400 transition-colors">5. CloudWatch &amp; CDN</a>
            <a href="#logs-section" className="hover:text-amber-400 transition-colors">6. Log Stream</a>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        {/* =====================================================================
            SECTION 1: AWS SIGN-IN & AUTHENTICATION MANAGER
           ===================================================================== */}
        <section id="aws-auth-section" className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5" /> Identity &amp; Access Management (IAM / SSO)
              </span>
              <h2 className="text-xl font-bold text-white mt-1">1. Connect &amp; Authenticate to AWS</h2>
              <p className="text-xs text-slate-400">
                Sign in using your browser (AWS Builder ID / SSO) or configure Access Keys to directly execute commands and manage cloud resources.
              </p>
            </div>

            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs">
              <button
                onClick={() => setAuthMode('sso')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  authMode === 'sso' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Browser SSO Login
              </button>
              <button
                onClick={() => setAuthMode('keys')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  authMode === 'keys' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                IAM Access Keys
              </button>
            </div>
          </div>

          {/* Current Auth Status Card */}
          <div className="grid sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-slate-400 block">Connection Status</span>
              <span className={`font-bold mt-1 block ${isAwsAuth ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isAwsAuth ? 'AUTHENTICATED' : 'NOT AUTHENTICATED'}
              </span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block">AWS Account ID</span>
                <span className="font-semibold text-white mt-1 block truncate">
                  {cloudState.aws?.account || 'None'}
                </span>
              </div>
              {isAwsAuth && (
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-mono text-[11px] cursor-pointer"
                >
                  {signingOut ? 'Signing out...' : 'Sign Out'}
                </button>
              )}
            </div>
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 sm:col-span-2">
              <span className="text-slate-400 block">Caller ARN</span>
              <span className="font-semibold text-sky-400 mt-1 block truncate" title={cloudState.aws?.arn}>
                {cloudState.aws?.arn || 'Not connected'}
              </span>
            </div>
          </div>

          {/* Auth Mode 1: Browser SSO */}
          {authMode === 'sso' ? (
            <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white text-sm">One-Click Browser SSO Authentication</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sign in with your AWS Builder ID or IAM Identity Center without creating or pasting any secret keys.
                  </p>
                </div>
                <button
                  onClick={handleStartSsoLogin}
                  disabled={ssoLoading}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ssoLoading ? 'animate-spin' : ''}`} />
                  {ssoLoading ? 'Opening AWS Session...' : '1. Open AWS Sign-in Link'}
                </button>
              </div>

              {ssoLoginUrl && (
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/40 space-y-4">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Step 1: Authorize in your browser:
                    </span>
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        readOnly
                        value={ssoLoginUrl}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-sky-300 truncate"
                      />
                      <a
                        href={ssoLoginUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open AWS Sign-in Page
                      </a>
                    </div>
                  </div>

                  <form onSubmit={handleSubmitAuthCode} className="space-y-2 pt-3 border-t border-slate-800/80">
                    <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5" /> Step 2: Paste the authorization code displayed in your browser:
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ssoAuthCode}
                        onChange={(e) => setSsoAuthCode(e.target.value)}
                        placeholder="Paste code from AWS confirmation page (e.g. ABCD-1234)"
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                      />
                      <button
                        type="submit"
                        disabled={submittingCode || !ssoAuthCode.trim()}
                        className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        {submittingCode ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {submittingCode ? 'Connecting...' : 'Complete Sign-in'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ) : (
            /* Auth Mode 2: Static Access Keys */
            <form onSubmit={handleConfigureKeys} className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
              <h3 className="font-semibold text-white text-sm">Configure IAM Access Key ID &amp; Secret Key</h3>
              <div className="grid sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Access Key ID</label>
                  <input
                    type="text"
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    placeholder="AKIA..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Secret Access Key</label>
                  <input
                    type="password"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Default Region</label>
                  <input
                    type="text"
                    value={awsRegion}
                    onChange={(e) => setAwsRegion(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!accessKey.trim() || !secretKey.trim()}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-xs cursor-pointer"
              >
                Save &amp; Connect AWS Credentials
              </button>
            </form>
          )}
        </section>

        {/* =====================================================================
            SECTION 2: DIRECT AWS TERMINAL COMMAND RUNNER
           ===================================================================== */}
        <section id="terminal-section" className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" /> Interactive AWS CLI Execution Engine
              </span>
              <h2 className="text-xl font-bold text-white mt-1">2. Run Terminal Commands Right Inside the UI</h2>
              <p className="text-xs text-slate-400">
                Execute any AWS CLI or shell commands from <code className="text-amber-300">commands.sh</code> directly from this web page.
              </p>
            </div>
            {cloudState.commandHistory?.length > 0 && (
              <button
                onClick={() => fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'commands' }) }).then(fetchState)}
                className="text-xs text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1.5 rounded-lg cursor-pointer self-start"
              >
                Clear Terminal History
              </button>
            )}
          </div>

          {/* Quick Preset Command Pills */}
          <div>
            <span className="text-xs font-mono text-slate-400 block mb-2">Preset Commands (Click to load):</span>
            <div className="flex flex-wrap gap-2">
              {PRESET_COMMANDS.map((item) => (
                <button
                  key={item.label}
                  onClick={() => setTerminalCmd(item.cmd)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 cursor-pointer transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Command Input Bar */}
          <form onSubmit={(e) => { e.preventDefault(); handleRunCommand(); }} className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-amber-400">$</span>
              <input
                type="text"
                value={terminalCmd}
                onChange={(e) => setTerminalCmd(e.target.value)}
                placeholder="Enter AWS CLI command (e.g. aws sts get-caller-identity or aws s3 ls)"
                className="w-full pl-8 pr-4 py-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <button
              type="submit"
              disabled={runningCmd || !terminalCmd.trim()}
              className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              {runningCmd ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {runningCmd ? 'Executing...' : 'Run in Terminal'}
            </button>
          </form>

          {/* Terminal Output History */}
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs max-h-72 overflow-y-auto space-y-3">
            {cloudState.commandHistory?.length === 0 ? (
              <div className="text-slate-500 py-6 text-center">
                Terminal output will display here. Click a preset command above or type your own to execute!
              </div>
            ) : (
              cloudState.commandHistory?.map((item) => (
                <div key={item.id} className="border-b border-slate-800 pb-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="text-amber-400 font-bold">$ {item.command}</span>
                    <span className={item.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      Exit: {item.exitCode} ({item.durationMs}ms)
                    </span>
                  </div>
                  <pre className="text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed bg-slate-900/60 p-2.5 rounded-lg">
                    {item.output}
                  </pre>
                </div>
              ))
            )}
          </div>
        </section>

        {/* =====================================================================
            SECTION 3: REAL-TIME URL LATENCY PROBE -> PUSH TO CLOUDWATCH
           ===================================================================== */}
        <section id="probe-section" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Amazon CloudWatch Synthetics &amp; Real-Time Socket Probe
              </span>
              <h2 className="text-xl font-bold text-white mt-1">3. Live URL Latency, TLS &amp; Header Inspector</h2>
              <p className="text-xs text-slate-400">
                Measures DNS, TCP, TLS handshake, TTFB, status codes, and response headers, then streams metrics directly to Amazon CloudWatch.
              </p>
            </div>
            {cloudState.probes?.length > 0 && (
              <button
                onClick={() => fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'probes' }) }).then(fetchState)}
                className="text-xs text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1.5 rounded-lg cursor-pointer self-start"
              >
                Clear Probes
              </button>
            )}
          </div>

          <form onSubmit={handleRunProbe} className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Enter URL to probe (e.g. https://aws.amazon.com or https://github.com)"
                className="w-full pl-11 pr-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
              />
            </div>
            <button
              type="submit"
              disabled={probing || !urlInput.trim()}
              className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              {probing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {probing ? 'Probing...' : 'Measure & Push to CloudWatch'}
            </button>
          </form>

          {probeError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs font-mono">
              {probeError}
            </div>
          )}

          {activeProbe && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="font-mono text-sm font-bold text-amber-400">{activeProbe.url}</div>
                <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold ${
                  activeProbe.statusCode >= 200 && activeProbe.statusCode < 400
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}>
                  HTTP {activeProbe.statusCode} {activeProbe.reason}
                </span>
              </div>

              {/* 5 Latency KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">DNS Lookup</span>
                  <span className="text-lg font-bold text-sky-400 mt-1 block">{activeProbe.dnsMs} ms</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">TCP Connect</span>
                  <span className="text-lg font-bold text-emerald-400 mt-1 block">{activeProbe.tcpMs} ms</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">TLS Handshake</span>
                  <span className="text-lg font-bold text-purple-400 mt-1 block">{activeProbe.tlsMs} ms</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">TTFB Wait</span>
                  <span className="text-lg font-bold text-amber-400 mt-1 block">{activeProbe.ttfbMs} ms</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 col-span-2 sm:col-span-1">
                  <span className="text-slate-400 block text-[11px]">Total Latency</span>
                  <span className="text-lg font-bold text-white mt-1 block">{activeProbe.totalMs} ms</span>
                </div>
              </div>

              {/* Header Inspector */}
              <div>
                <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                  Live HTTP Response Headers ({Object.keys(activeProbe.headers || {}).length})
                </h4>
                <div className="max-h-48 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs space-y-1">
                  {Object.entries(activeProbe.headers || {}).map(([k, v]) => (
                    <div key={k} className="flex gap-2 border-b border-slate-900 pb-1">
                      <span className="text-amber-400 shrink-0">{k}:</span>
                      <span className="text-slate-300 break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* =====================================================================
            SECTION 4: S3 BUCKET CREATION & OBJECT STORAGE MANAGER
           ===================================================================== */}
        <section id="s3-section" className="space-y-6 pt-4 border-t border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" /> Amazon S3 Cloud Storage &amp; Bucket Provisioning
              </span>
              <h2 className="text-xl font-bold text-white mt-1">4. S3 Bucket File Manager &amp; Bucket Creator</h2>
              <p className="text-xs text-slate-400">
                Upload files, inspect RFC MD5 ETags, delete objects, or create new S3 buckets directly on your AWS account.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" id="s3-upload-input" />
              <label
                htmlFor="s3-upload-input"
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading to S3...' : 'Upload Files to S3'}
              </label>
            </div>
          </div>

          {/* Bucket Selector & Creator Bar */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Create New Bucket Form */}
            <form onSubmit={handleCreateBucket} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-xs font-mono text-slate-400 block">Create New S3 Bucket on AWS</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBucketName}
                  onChange={(e) => setNewBucketName(e.target.value)}
                  placeholder="e.g. cloudpulse-frontend-unique123"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                />
                <button
                  type="submit"
                  disabled={creatingBucket || !newBucketName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  {creatingBucket ? 'Creating...' : 'Create Bucket'}
                </button>
              </div>
            </form>

            {/* Active S3 Bucket Selector */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-xs font-mono text-slate-400 block">Active Target Bucket</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-sky-400 font-bold flex-1 truncate">
                  s3://{cloudState.s3.bucketName}
                </span>
                {cloudState.aws?.availableBuckets?.length > 0 && (
                  <select
                    value={cloudState.s3.bucketName}
                    onChange={(e) => handleSelectBucket(e.target.value)}
                    className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200"
                  >
                    {cloudState.aws.availableBuckets.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* S3 Objects Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                  <th className="py-3 px-4">Object Key</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Last Modified</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {cloudState.s3.objects?.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-6 text-center text-slate-500">
                      Bucket is empty. Click &ldquo;Upload Files to S3&rdquo; above!
                    </td>
                  </tr>
                ) : (
                  cloudState.s3.objects.map((obj) => (
                    <tr key={obj.key} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-semibold text-white">{obj.key}</td>
                      <td className="py-2.5 px-4 text-sky-400">{obj.source}</td>
                      <td className="py-2.5 px-4 text-slate-300">{formatBytes(obj.sizeBytes)}</td>
                      <td className="py-2.5 px-4 text-slate-400">{obj.lastModified}</td>
                      <td className="py-2.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => setInspectedObject(obj)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer"
                        >
                          Inspect
                        </button>
                        <a
                          href={`/api/s3/download/${encodeURIComponent(obj.key)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300"
                        >
                          Open
                        </a>
                        <button
                          onClick={() => handleDeleteS3Object(obj.key)}
                          className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* =====================================================================
            SECTION 5: CLOUDWATCH ALARMS & CLOUDFRONT CACHE PURGE
           ===================================================================== */}
        <section id="alarms-section" className="space-y-6 pt-4 border-t border-slate-800">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> CloudWatch Alarms &amp; CloudFront Invalidation
            </span>
            <h2 className="text-xl font-bold text-white mt-1">5. CloudWatch Alarms &amp; CloudFront Edge Invalidation</h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Create CloudWatch Alarm */}
            <form onSubmit={handleCreateAlarm} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Create CloudWatch Metric Alarm
              </h3>
              <div>
                <label className="text-slate-400 block mb-1">Alarm Name</label>
                <input
                  type="text"
                  value={alarmName}
                  onChange={(e) => setAlarmName(e.target.value)}
                  placeholder="e.g. High-Latency-Alert"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Metric</label>
                  <select
                    value={alarmMetric}
                    onChange={(e) => setAlarmMetric(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
                  >
                    <option value="TotalLatencyMs">TotalLatencyMs</option>
                    <option value="DnsLookupMs">DnsLookupMs</option>
                    <option value="TlsHandshakeMs">TlsHandshakeMs</option>
                    <option value="TtfbMs">TtfbMs</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Condition</label>
                  <select
                    value={alarmOperator}
                    onChange={(e) => setAlarmOperator(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
                  >
                    <option value=">">&gt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<">&lt;</option>
                    <option value="<=">&lt;=</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Threshold (ms)</label>
                  <input
                    type="number"
                    value={alarmThreshold}
                    onChange={(e) => setAlarmThreshold(e.target.value)}
                    placeholder="150"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={creatingAlarm || !alarmName.trim() || alarmThreshold === ''}
                className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold cursor-pointer"
              >
                {creatingAlarm ? 'Creating...' : 'Create & Sync to CloudWatch'}
              </button>
            </form>

            {/* CloudFront Invalidation */}
            <form onSubmit={handleInvalidateCache} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-sky-400" />
                Trigger CloudFront Edge Cache Invalidation
              </h3>
              <div>
                <label className="text-slate-400 block mb-1">Paths to Invalidate (e.g. /* or /index.html)</label>
                <input
                  type="text"
                  value={invalidationPaths}
                  onChange={(e) => setInvalidationPaths(e.target.value)}
                  placeholder="/*"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Distribution ID (Optional, for real AWS)</label>
                <input
                  type="text"
                  value={invalidationDistId}
                  onChange={(e) => setInvalidationDistId(e.target.value)}
                  placeholder="e.g. E2X9K4L7M1P8Q"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-white"
                />
              </div>
              <button
                type="submit"
                disabled={invalidating || !invalidationPaths.trim()}
                className="w-full py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold cursor-pointer"
              >
                {invalidating ? 'Invalidating...' : 'Purge Edge Cache'}
              </button>
            </form>
          </div>
        </section>

        {/* =====================================================================
            SECTION 6: REAL-TIME BACKEND EVENT LOG CONSOLE
           ===================================================================== */}
        <section id="logs-section" className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" /> Real-Time CloudWatch Event Log Stream
            </span>
            <button
              onClick={() => fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'logs' }) }).then(fetchState)}
              className="text-xs text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1 rounded cursor-pointer"
            >
              Clear Logs
            </button>
          </div>

          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 font-mono text-xs max-h-64 overflow-y-auto space-y-1">
            {cloudState.logs?.length === 0 ? (
              <div className="text-slate-500 py-6 text-center">No logs recorded yet.</div>
            ) : (
              cloudState.logs?.map((log) => (
                <div key={log.id} className="flex gap-2 py-0.5 border-b border-slate-800/50">
                  <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                    log.level === 'ALERT' || log.level === 'ERROR'
                      ? 'bg-rose-500/20 text-rose-300'
                      : log.level === 'WARN'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {log.service}
                  </span>
                  <span className="text-slate-200 break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="bg-slate-950 border-t border-slate-800 py-6 text-xs text-slate-400 text-center font-mono">
        CloudPulse AWS Control Console • Connected to WSL2 Ubuntu &amp; AWS ap-south-1
      </footer>
    </div>
  );
}
