import {
  nip44DecryptWithNode,
  nip44EncryptWithNode,
  prepareEcdhOnNode,
  prepareSignOnNode,
  signNostrEvent,
} from '@/lib/igloo';
import { PROVIDER_METHOD, type ProviderMethod } from '@/extension/protocol';
import type { SignerSession } from '@/lib/runtime-host/types';

export async function executeProviderMethodOnSession(input: {
  session: SignerSession;
  method: ProviderMethod;
  params?: Record<string, unknown>;
}) {
  const { session, method, params } = input;

  switch (method) {
    case PROVIDER_METHOD.SIGN_EVENT: {
      if (!params || typeof params !== 'object' || typeof params.event !== 'object' || !params.event) {
        throw new Error('signEvent requires an event payload');
      }
      await prepareSignOnNode(session.node);
      return await signNostrEvent(session.node, params.event as Record<string, unknown>);
    }
    case PROVIDER_METHOD.NIP44_ENCRYPT: {
      if (typeof params?.pubkey !== 'string' || typeof params?.plaintext !== 'string') {
        throw new Error('nip44.encrypt requires pubkey and plaintext');
      }
      await prepareEcdhOnNode(session.node);
      return await nip44EncryptWithNode(session.node, params.pubkey, params.plaintext);
    }
    case PROVIDER_METHOD.NIP44_DECRYPT: {
      if (typeof params?.pubkey !== 'string' || typeof params?.ciphertext !== 'string') {
        throw new Error('nip44.decrypt requires pubkey and ciphertext');
      }
      await prepareEcdhOnNode(session.node);
      return await nip44DecryptWithNode(session.node, params.pubkey, params.ciphertext);
    }
    default:
      throw new Error(`Unsupported runtime method: ${method}`);
  }
}
