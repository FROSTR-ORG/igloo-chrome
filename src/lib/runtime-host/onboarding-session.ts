import {
  connectSignerNode,
  createSignerNode,
  decodeOnboardingProfile,
  getRuntimeStatus,
} from '@/lib/igloo';
import { normalizeSignerSettings, type SignerSettings } from '@/lib/signer-settings';
import type { PendingOnboardingProfile } from '@/extension/protocol';
import { attachOnboardingLogBuffer } from '@/lib/runtime-host/diagnostics';
import { shutdownNode, toErrorMessage, withTimeout } from '@/lib/runtime-host/helpers';
import { waitForNonceSnapshot } from '@/lib/runtime-host/readiness';
import { runtimePayloadFromSnapshot } from '@/lib/runtime-host/session-bootstrap';

const ONBOARDING_CONNECT_TIMEOUT_MS = 15_000;

export async function captureOnboardingRuntimeProfile(input: {
  packageText: string;
  password: string;
  groupName?: string;
  signerSettings?: Partial<SignerSettings>;
  onProgress?: (
    stage: 'decoding_package' | 'connecting_peer' | 'awaiting_onboard_response' | 'snapshot_captured',
    detail?: Record<string, unknown>
  ) => Promise<void> | void;
}): Promise<PendingOnboardingProfile> {
  await input.onProgress?.('decoding_package', {
    packageLength: input.packageText.trim().length,
  });
  const decoded = await decodeOnboardingProfile(input.packageText, input.password);
  const node = createSignerNode({
    mode: 'onboarding',
    onboardPackage: input.packageText.trim(),
    onboardPassword: input.password,
    relays: decoded.relays,
    signerSettings: normalizeSignerSettings(input.signerSettings),
  });
  const logs = attachOnboardingLogBuffer(node);

  try {
    await input.onProgress?.('connecting_peer', {
      peerPubkey: decoded.peerPubkey,
      relayCount: decoded.relays.length,
    });
    await withTimeout(connectSignerNode(node), ONBOARDING_CONNECT_TIMEOUT_MS, 'Onboarding connect');
    await input.onProgress?.('awaiting_onboard_response', {
      peerPubkey: decoded.peerPubkey,
      relayCount: decoded.relays.length,
    });
    const snapshot = await waitForNonceSnapshot(node);
    const runtimeSnapshotJson = JSON.stringify(snapshot);
    await input.onProgress?.('snapshot_captured', {
      peerPubkey: decoded.peerPubkey,
      relayCount: decoded.relays.length,
    });
    const payload = await runtimePayloadFromSnapshot({
      label: input.groupName?.trim() || 'Onboarded device',
      relays: decoded.relays,
      runtimeSnapshotJson,
    });
    return {
      id: payload.profileId,
      groupName: input.groupName,
      relays: decoded.relays,
      groupPublicKey: getRuntimeStatus(node).metadata.group_public_key,
      publicKey: getRuntimeStatus(node).metadata.group_public_key,
      sharePublicKey: decoded.publicKey,
      peerPubkey: decoded.peerPubkey,
      signerSettings: normalizeSignerSettings(input.signerSettings),
      runtimeSnapshotJson,
      profilePayload: payload,
    };
  } catch (error) {
    const lines = logs.collect().slice(-20);
    const suffix = lines.length > 0 ? ` | runtime_logs=${JSON.stringify(lines)}` : '';
    throw new Error(`${toErrorMessage(error)}${suffix}`);
  } finally {
    logs.detach();
    await shutdownNode(node).catch(() => undefined);
  }
}
