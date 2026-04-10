import type { ProviderRequestEnvelope } from '@/extension/protocol';

export type PromptState = {
  request: ProviderRequestEnvelope;
  resolve: (allow: boolean) => void;
  windowId?: number;
};

export function createPromptRegistry() {
  const pendingPrompts = new Map<string, PromptState>();
  const promptWindowMap = new Map<number, string>();

  return {
    set(requestId: string, state: PromptState) {
      pendingPrompts.set(requestId, state);
    },
    get(requestId: string) {
      return pendingPrompts.get(requestId);
    },
    delete(requestId: string) {
      const pending = pendingPrompts.get(requestId);
      pendingPrompts.delete(requestId);
      if (typeof pending?.windowId === 'number') {
        promptWindowMap.delete(pending.windowId);
      }
      return pending ?? null;
    },
    setWindowId(requestId: string, windowId: number) {
      const pending = pendingPrompts.get(requestId);
      if (!pending) {
        return null;
      }
      pending.windowId = windowId;
      promptWindowMap.set(windowId, requestId);
      return pending;
    },
    deleteByWindowId(windowId: number) {
      const requestId = promptWindowMap.get(windowId);
      if (!requestId) {
        return null;
      }
      promptWindowMap.delete(windowId);
      return this.delete(requestId);
    },
    size() {
      return pendingPrompts.size;
    },
  };
}
