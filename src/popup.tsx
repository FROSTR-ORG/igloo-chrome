import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { AppHeader, Button, Card, CardContent, CardHeader, CardTitle } from 'igloo-ui';
import { getChromeApi } from '@/extension/chrome';
import { fetchExtensionAppState } from '@/extension/client';
import type { ExtensionAppState } from '@/extension/protocol';

function PopupApp() {
  const [status, setStatus] = React.useState<ExtensionAppState | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await fetchExtensionAppState());
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDashboard = React.useCallback(async () => {
    const chromeApi = getChromeApi();
    if (!chromeApi?.runtime?.sendMessage) return;
    await chromeApi.runtime.sendMessage({ type: 'ext.openDashboard' });
    window.close();
  }, []);

  return (
    <div className="min-h-screen bg-transparent p-4 text-white" style={{ width: 360 }}>
      <AppHeader title="igloo-chrome" subtitle="MV3 signer control plane" className="mb-4" />

      <Card className="border-blue-900/30 bg-slate-950/80">
        <CardHeader>
          <CardTitle className="text-lg text-blue-100">Extension Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
              {error}
            </div>
          )}

          {!error && status && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Profile</span>
                <span className="font-medium text-blue-100">
                  {status.configured ? status.profile?.groupName || 'Configured' : 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Runtime</span>
                <span className="font-medium text-cyan-200">{status.runtime.phase}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Activation</span>
                <span className="font-medium text-cyan-200">
                  {status.lifecycle.activation.stage}
                </span>
              </div>
              {status.lifecycle.activation.lastError && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
                  {status.lifecycle.activation.lastError.message}
                </div>
              )}
              <div className="space-y-1">
                <div className="text-slate-400">Public key</div>
                <div className="rounded border border-blue-950/60 bg-blue-950/20 px-3 py-2 font-mono text-xs text-blue-100">
                  {status.runtime.metadata?.group_public_key ||
                    status.profile?.groupPublicKey ||
                    'Available after onboarding decode'}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={openDashboard}>
              Open dashboard
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
