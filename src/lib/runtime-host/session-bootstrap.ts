import {
  createBrowserRuntimeNodeInit,
  connectSignerNode,
  createSignerNode,
  runtimePayloadFromSnapshot as createRuntimePayloadFromSnapshot,
  type BrowserProfilePackagePayload,
} from '@/lib/igloo';
import type { StoredExtensionProfile } from '@/extension/protocol';
import { withTimeout } from '@/lib/runtime-host/helpers';

const RUNTIME_CONNECT_TIMEOUT_MS = 10_000;

export async function runtimePayloadFromSnapshot(args: {
  label: string;
  relays: string[];
  runtimeSnapshotJson: string;
}) {
  return await createRuntimePayloadFromSnapshot(args);
}

export function createRuntimeNodeForProfile(
  profile: StoredExtensionProfile,
  profilePayload?: BrowserProfilePackagePayload
) {
  const init = createBrowserRuntimeNodeInit(profile, profilePayload);
  return createSignerNode(init.config, init.restoreOptions);
}

export async function connectRuntimeNode(node: ReturnType<typeof createSignerNode>) {
  await withTimeout(connectSignerNode(node), RUNTIME_CONNECT_TIMEOUT_MS, 'Signer runtime connect');
}
