import { createRuntimeHostController } from '@/lib/runtime-host/controller';
import {
  adaptRuntimeDiagnosticsSnapshot,
  adaptRuntimeSnapshotDetails,
  adaptRuntimeStatusSnapshot,
  adaptRuntimeStatusSummary,
  adaptRuntimeStatusUpdate,
} from '@/lib/runtime-status-adapter';
import type {
  RuntimeDiagnosticsCore,
  RuntimePhase,
  RuntimeSnapshotInspection,
  RuntimeStatusSnapshot,
} from '@/extension/protocol';

const runtimeHost = createRuntimeHostController();

export function setRuntimeHostStatusListener(
  listener: (update: {
    runtime: RuntimePhase;
    status: RuntimeStatusSnapshot['status'];
  }) => void | Promise<void>
) {
  runtimeHost.setRuntimeHostStatusListener((update) => listener(adaptRuntimeStatusUpdate(update)));
}
export const isRuntimeActive = runtimeHost.isRuntimeActive;
export const captureOnboardingProfile = runtimeHost.captureOnboardingProfile;
export const ensureRuntime = runtimeHost.ensureRuntime;
export async function getRuntimeStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
  return adaptRuntimeStatusSnapshot(await runtimeHost.getRuntimeStatusSnapshot());
}
export async function getRuntimeSnapshotDetails(): Promise<RuntimeSnapshotInspection> {
  return adaptRuntimeSnapshotDetails(await runtimeHost.getRuntimeSnapshotDetails());
}
export async function getRuntimeDiagnosticsSnapshot(): Promise<RuntimeDiagnosticsCore> {
  const [diagnostics, runtimeSnapshot] = await Promise.all([
    runtimeHost.getRuntimeDiagnosticsSnapshot(),
    runtimeHost.getRuntimeSnapshotDetails(),
  ]);
  return adaptRuntimeDiagnosticsSnapshot(
    diagnostics,
    adaptRuntimeSnapshotDetails(runtimeSnapshot)
  );
}
export const stopRuntime = runtimeHost.stopRuntime;
export const readRuntimeConfig = runtimeHost.readRuntimeConfig;
export const updateRuntimeConfig = runtimeHost.updateRuntimeConfig;
export async function updateRuntimePeerPolicy(
  ...args: Parameters<typeof runtimeHost.updateRuntimePeerPolicy>
): Promise<RuntimeStatusSnapshot['status']> {
  return adaptRuntimeStatusSummary(await runtimeHost.updateRuntimePeerPolicy(...args));
}
export async function clearRuntimePeerPolicyOverrides(): Promise<RuntimeStatusSnapshot['status']> {
  return adaptRuntimeStatusSummary(await runtimeHost.clearRuntimePeerPolicyOverrides());
}
export const refreshAllPeers = runtimeHost.refreshAllPeers;
export const prepareSign = runtimeHost.prepareSign;
export const prepareEcdh = runtimeHost.prepareEcdh;
export const wipeRuntimeState = runtimeHost.wipeRuntimeState;
export const decodeProfile = runtimeHost.decodeProfile;
export const executeProviderMethod = runtimeHost.executeProviderMethod;
