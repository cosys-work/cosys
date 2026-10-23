/**
 * The bridge's outbox: signs `bridge:` row drafts under the bridge key and deposits them, sealed,
 * into one patient's mailbox.
 * @module
 */

import { ulid } from '@cosys/crypto/ulid';
import {
  MESSAGE_TYPE,
  sealForMailbox,
  signBridgeRow,
  type DeviceIdentity,
  type Mailbox,
  type MailboxAddress,
  type Message,
  type SyncEntry,
} from '@cosys/peer';

import type { BridgeRowDraft } from './codec.ts';

// The bridge holds the rows it writes: it is the process that decided to (`bridge-kinds.ts`).
import '@cosys/record/bridge-kinds';

/**
 * The network face of a bridge (ADR-22 §1): it signs each row under the bridge key and deposits
 * it into the one patient's mailbox, as any depositor does (ADR-15 §2). The mailbox is not told
 * what it carries; a bridge is one more depositor the patient allowed, and nothing in `wire.ts`,
 * the messages or the mailbox changes for it.
 */
export interface OutboxOptions {
  /** The bridge's identity: its seed is the bridge key its directory entry names. */
  readonly identity: DeviceIdentity;
  /** Which running copy this is, for the instance signature (`bridge-rows.ts`). */
  readonly instance: string;
  /** The patient's certified mailbox key, from the directory. */
  addressOf(patient: string): Promise<MailboxAddress>;
  /** The patient's mailbox, as a depositor sees it. */
  depositTo(patient: string): Mailbox;
  /** The clock for row ids and `recordedAt`; the system clock when absent. */
  readonly now?: () => Date;
}

/** Delivers signed bridge rows to one patient at a time; made by {@link createOutbox}. */
export interface Outbox {
  /** Signs the drafts for `patient`, deposits them in one frame, and returns the rows as sent. */
  deliver(patient: string, drafts: readonly BridgeRowDraft[]): Promise<readonly SyncEntry[]>;
}

/** The most rows one batch carries (`batchBodySchema`). */
const BATCH_MAX = 512;

/**
 * Creates an outbox. Each delivery signs every draft under the bridge key, splits the rows into
 * batches of at most 512, seals them to the patient's mailbox address and deposits one frame.
 * No drafts means no deposit; a failed address lookup or deposit rejects.
 */
export function createOutbox(options: OutboxOptions): Outbox {
  const now = options.now ?? (() => new Date());
  const signer = { bridgeSeed: options.identity.secretKey, instance: options.instance };
  return {
    async deliver(patient, drafts) {
      if (drafts.length === 0) return [];
      const at = now();
      const rows = drafts.map((draft) =>
        signBridgeRow(
          {
            id: ulid(at.getTime()),
            kind: draft.kind,
            deviceId: options.identity.deviceId,
            occurredAt: draft.occurredAt,
            recordedAt: at.toISOString(),
          },
          patient,
          draft.body,
          signer,
        ),
      );
      const messages: Message[] = [];
      for (let start = 0; start < rows.length; start += BATCH_MAX) {
        messages.push({
          type: MESSAGE_TYPE.batch,
          body: {
            deviceId: options.identity.deviceId,
            after: null,
            rows: rows.slice(start, start + BATCH_MAX),
          },
        });
      }
      messages.push({ type: MESSAGE_TYPE.done });
      const address = await options.addressOf(patient);
      const parts: Uint8Array[] = [];
      for await (const part of sealForMailbox(
        options.identity,
        address,
        iterate(messages),
        `bridge-${at.getTime()}`,
      )) {
        parts.push(part);
      }
      await options.depositTo(patient).deposit(concat(parts));
      return rows;
    },
  };
}

async function* iterate<T>(items: readonly T[]): AsyncIterable<T> {
  yield* items;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
