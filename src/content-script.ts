import { getChromeApi } from '@/extension/chrome';
import { EXTENSION_SOURCE, MESSAGE_TYPE, isRecord } from '@/extension/protocol';

function injectProviderScript() {
  const chromeApi = getChromeApi();
  const runtimeUrl = chromeApi?.runtime?.getURL?.('nostr-provider.js');
  if (!runtimeUrl || document.querySelector('script[data-igloo-provider="1"]')) return;

  const script = document.createElement('script');
  script.dataset.iglooProvider = '1';
  script.type = 'text/javascript';
  script.src = runtimeUrl;
  (document.head || document.documentElement).appendChild(script);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: typeof error === 'string' ? error : 'Unknown extension error' };
}

injectProviderScript();

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!isRecord(event.data)) return;
  if (event.data.source !== EXTENSION_SOURCE || event.data.direction !== 'provider_request') return;

  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) return;

  let response:
    | { ok: true; result: unknown }
    | { ok: false; error: { message: string } };

  try {
    const result = (await chromeApi.runtime.sendMessage({
      type: MESSAGE_TYPE.PROVIDER_REQUEST,
      request: {
        id: event.data.id,
        type: event.data.type,
        params: event.data.params ?? {},
        host: window.location.host,
        origin: window.location.origin,
        href: window.location.href
      }
    })) as { ok?: boolean; result?: unknown; error?: string } | undefined;

    response = result?.ok
      ? { ok: true, result: result.result }
      : { ok: false, error: { message: result?.error || 'Extension request failed' } };
  } catch (error) {
    response = { ok: false, error: serializeError(error) };
  }

  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      direction: 'provider_response',
      id: event.data.id,
      ...response
    },
    '*'
  );
});
