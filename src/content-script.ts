import { getChromeApi } from '@/extension/chrome';
import { COMMAND_TYPE, EXTENSION_SOURCE, isRecord } from '@/extension/protocol';

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
  // Only accept requests from this exact page origin — a cross-origin frame
  // must not be able to forge a provider_request.
  if (event.origin !== window.location.origin) return;
  if (!isRecord(event.data)) return;
  if (event.data.source !== EXTENSION_SOURCE || event.data.direction !== 'provider_request') return;

  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) return;

  let response:
    | { ok: true; result: unknown }
    | { ok: false; error: { message: string } };

  try {
    const result = (await chromeApi.runtime.sendMessage({
      type: COMMAND_TYPE.PROVIDER_REQUEST,
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

  // Origin-pinned: only the same-origin page provider receives the response,
  // so a cross-origin frame can't sniff signed events / encryption results.
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      direction: 'provider_response',
      id: event.data.id,
      ...response
    },
    window.location.origin
  );
});
