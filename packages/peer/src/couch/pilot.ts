import { bytesToHex, concatBytes, toBase64 } from '../deps.ts';
import { openFromMailbox, sealForMailbox, type MailboxAddress } from '../mailbox.ts';
import { MESSAGE_TYPE, ProtocolError, type Message } from '../messages.ts';
import type { DeviceIdentity } from '../identity.ts';
import { CouchClient } from './client.ts';
import {
  createProvisioningClient,
  pilotMailboxName,
  type ErasureAnswer,
  type ProvisioningOptions,
  type SigningKey,
} from './provisioning.ts';

/**
 * The pilot mailbox, from the device's side (ADR-12 §M1, §M2, §M5).
 *
 * Telemetry is a depositor on the mailbox and nothing else, so this is the smallest client in
 * the package: consent, revoke, and one deposit per day into `mbx-pilot-<telemetry key>`. It is
 * built from the pieces relationship mail already uses (the provisioning exchange, `CouchClient`
 * and the static-key seal) rather than beside them, because §M1's whole argument is that
 * telemetry wants a subset of what the mailbox already does. A second HTTP client or a second
 * sealing mode would be the thing that argument exists to avoid.
 *
 * ## Why this is not `createCouchMailbox`
 *
 * Two differences, both real. A pilot mailbox is named for its depositor rather than for a
 * relationship (`mailboxDatabaseName` has no form for it, and should not grow one: a scope is a
 * patient's decision about who may see whom, and this is not that). And a deposit here carries
 * **its own id**, one per day, which is what makes a retry idempotent at the server: a second
 * write under the same id is a conflict, not a second batch, so a phone that lost the response
 * to a successful deposit and tries again does not double-count a day.
 *
 * ## It names no host
 *
 * `service` and `mailbox` are parameters with no default, like every URL in this package, so
 * `scripts/check-no-egress.mjs`'s rule holds here too.
 */

export interface PilotClientOptions extends Omit<ProvisioningOptions, 'server'> {
  /** The provisioning service: `/challenge`, `/token`, `/pilot-consent`, `/pilot-revoke`. */
  readonly service: string;
  /** CouchDB itself, where `mbx-pilot-<key>` lives. Same hostname, different port or path. */
  readonly mailbox: string;
}

/** What a deposit did. `already-held` is success: the server has that day under that id. */
export type PilotDepositResult = 'stored' | 'already-held';

/** The device's side of the pilot mailbox: consent, revoke, the daily deposit, and erasure. */
export interface PilotClient {
  /** Puts this key on the pilot's deposit allowlist and creates its mailbox. */
  consent(key: SigningKey): Promise<void>;
  /** Takes this key off the pilot allowlist; after it the service issues the key no token. */
  revoke(key: SigningKey): Promise<void>;
  /**
   * Deposits one sealed blob under `id`, one id per day. A repeat under the same id answers
   * `already-held`; a bad id, an oversized blob or a refusal throws.
   */
  deposit(key: SigningKey, id: string, blob: Uint8Array): Promise<PilotDepositResult>;
  /**
   * Erasure by capability (ADR-17 §3, §10; 2026-09-27): the archive's content key for this
   * telemetry key is destroyed, its rows deleted, and the holder answers with one signed
   * receipt, which the caller verifies. Works after revoke, when the key is gone from the phone.
   */
  erase(subject: Uint8Array, capability: Uint8Array): Promise<ErasureAnswer>;
}

/** A document id is ours to choose, within what CouchDB and the design document accept. */
const PILOT_DOC_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FRAME_BASE64 = 131_072;

/**
 * A `PilotClient` over the provisioning service at `options.service` and CouchDB at
 * `options.mailbox`.
 */
export function createPilotClient(options: PilotClientOptions): PilotClient {
  const provisioning = createProvisioningClient({ ...options, server: options.service });
  const mailboxServer = options.mailbox.replace(/\/+$/, '');

  return {
    consent: (key) => provisioning.pilotConsent(key),
    revoke: (key) => provisioning.pilotRevoke(key),
    erase: (subject, capability) => provisioning.pilotErase(subject, capability),

    async deposit(key, id, blob) {
      if (!PILOT_DOC_ID.test(id)) throw new TypeError('a pilot document id is lowercase and short');
      const frame = toBase64(blob);
      if (frame.length > MAX_FRAME_BASE64) {
        throw new Error('a frame is bounded at 64 KiB by the container; this one is not');
      }
      const client = new CouchClient({
        database: `${mailboxServer}/${pilotMailboxName(key.publicKey)}`,
        token: provisioning.pilotTokenSource(key),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      const [result] = await client.bulkDocs([
        { _id: id, from: bytesToHex(key.publicKey), frame, at: new Date().toISOString() },
      ]);
      if (result?.error === 'conflict') return 'already-held';
      if (result?.error !== undefined) {
        // The server is the authority on the allowlist. A refusal is the design working.
        throw new Error(`the pilot mailbox refused the deposit: ${result.error}`);
      }
      return 'stored';
    },
  };
}

/**
 * Seals one payload for the pilot's recipient, as one blob.
 *
 * **The same seal relationship mail uses**, unchanged: a one-sided session to a static,
 * certified mailbox key (ADR-14 finding 4), carrying one `chunk` message. No new message type,
 * because the only reader is the operator's own tool over the archive, and a protocol change for a
 * reader that never meets a phone would be a change every phone has to carry.
 *
 * The telemetry key signs the handshake. It has no `deviceId` and gets a fixed one here: a
 * `DeviceIdentity`'s id never goes on the wire (`encodeHandshake` names the key, the ephemeral,
 * the nonce and the signature), so this is a type obligation and not a disclosure.
 */
export async function sealPilotFrame(
  key: SigningKey,
  to: MailboxAddress,
  payload: Uint8Array,
  sessionId: string,
): Promise<Uint8Array> {
  const sender: DeviceIdentity = {
    deviceId: 'pilot',
    publicKey: key.publicKey,
    secretKey: key.secretKey,
  };
  const parts: Uint8Array[] = [];
  for await (const part of sealForMailbox(
    sender,
    to,
    one({ type: MESSAGE_TYPE.chunk, bytes: payload }),
    sessionId,
  )) {
    parts.push(part);
  }
  return concatBytes(parts);
}

/** The archive reader's half: opens a pilot frame with the recipient's identity. */
export async function openPilotFrame(
  recipient: DeviceIdentity,
  blob: Uint8Array,
): Promise<{ readonly sender: Uint8Array; readonly payload: Uint8Array }> {
  const delivery = await openFromMailbox(recipient, one(blob));
  const chunks: Uint8Array[] = [];
  for await (const message of delivery.messages) {
    if (message.type !== MESSAGE_TYPE.chunk)
      throw new ProtocolError('a pilot frame carries bytes only');
    chunks.push(message.bytes);
  }
  return { sender: delivery.senderIdentityKey, payload: concatBytes(chunks) };
}

async function* one<T extends Message | Uint8Array>(item: T): AsyncIterable<T> {
  yield item;
}

export { pilotMailboxName };
