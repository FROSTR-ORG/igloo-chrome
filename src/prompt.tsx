import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { Button, Card, CardContent, CardHeader, CardTitle } from 'igloo-ui';
import { getChromeApi } from '@/extension/chrome';
import { MESSAGE_TYPE, isProviderMethod } from '@/extension/protocol';

type PromptPayload = {
  id: string;
  host: string;
  type: string;
  label: string;
  kind?: number;
  params: string;
};

function readPromptPayload(): PromptPayload | null {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('id');
  const host = query.get('host');
  const type = query.get('type');
  const label = query.get('label');
  const params = query.get('params') ?? '{}';

  if (!id || !host || !type || !label) return null;

  let kind: number | undefined;
  try {
    const parsed = JSON.parse(params) as { event?: { kind?: number } };
    if (typeof parsed?.event?.kind === 'number') {
      kind = parsed.event.kind;
    }
  } catch {
    kind = undefined;
  }

  return { id, host, type, label, kind, params };
}

function PromptApp() {
  const payload = React.useMemo(() => readPromptPayload(), []);
  const [submitting, setSubmitting] = React.useState(false);

  const respond = React.useCallback(
    async (allow: boolean, scope: 'once' | 'forever' | 'kind') => {
      if (!payload) return;
      const chromeApi = getChromeApi();
      if (!chromeApi?.runtime?.sendMessage || !isProviderMethod(payload.type)) return;
      setSubmitting(true);
      try {
        await chromeApi.runtime.sendMessage({
          type: MESSAGE_TYPE.PROMPT_RESPONSE,
          id: payload.id,
          allow,
          scope
        });
      } catch (error) {
        setSubmitting(false);
        throw error;
      }
    },
    [payload]
  );

  if (!payload) {
    return (
      <div className="min-h-screen p-6 text-white">
        <Card className="border-red-900/30 bg-slate-950/80">
          <CardHeader>
            <CardTitle>Invalid permission request</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 text-white">
      <Card className="border-blue-900/30 bg-slate-950/90">
        <CardHeader>
          <CardTitle className="text-xl text-blue-100">{payload.host}</CardTitle>
          <div className="text-sm text-slate-400">wants to {payload.label}</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded border border-blue-950/60 bg-blue-950/20 px-3 py-2">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Request</div>
            <pre className="overflow-auto text-xs text-blue-100">{payload.params}</pre>
          </div>

          <div className="grid gap-2">
            <Button disabled={submitting} onClick={() => void respond(true, 'once')}>
              Allow once
            </Button>
            {typeof payload.kind === 'number' && (
              <Button
                disabled={submitting}
                variant="secondary"
                onClick={() => void respond(true, 'kind')}
              >
                Always allow kind {payload.kind}
              </Button>
            )}
            <Button
              disabled={submitting}
              variant="secondary"
              onClick={() => void respond(true, 'forever')}
            >
              Always allow this method
            </Button>
            <Button disabled={submitting} variant="destructive" onClick={() => void respond(false, 'once')}>
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PromptApp />
  </React.StrictMode>
);
