import type {
  BrowserBridgeNode,
  ObservabilityEvent,
  RuntimeStatusSummary,
} from '@/lib/igloo';
import type { RuntimePhase } from '@/extension/protocol';

export type SignerSession = {
  key: string;
  profileId: string;
  sessionKeyB64: string;
  node: BrowserBridgeNode;
  diagnostics: () => ObservabilityEvent[];
  droppedDiagnostics: () => number;
  detachDiagnostics: () => void;
  persistInFlight: Promise<void> | null;
  persistQueued: boolean;
};

export type RuntimeStatusUpdate = {
  runtime: RuntimePhase;
  status: RuntimeStatusSummary | null;
};

export type RuntimeStatusListener = (update: RuntimeStatusUpdate) => void | Promise<void>;
