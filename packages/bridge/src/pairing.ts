/**
 * How a bridge learns which foreign subject is which patient (ADR-22 §6; PLAN M19-3).
 *
 * **A patient cannot simply say which subject they are.** A lab's patient number is printed on
 * paper and guessable; a bridge that believed "Patient/123 is me" would send one person's results
 * to whoever claimed them first. So the foreign side offers a **one-time pairing code** for a
 * subject (printed on the report, shown as a QR at the lab's desk), the bridge keeps only the code's
 * digest, and the patient's phone sends a `paired_with` assertion it signs: about the bridge key,
 * naming the subject as an `origin`, with the code's digest as its evidence. The bridge pairs the
 * subject with the signer only when that digest was offered for that subject, unused and unexpired,
 * and the code is spent. A clinic that runs its own bridge already knows its patients and pairs them
 * directly (`BridgeState.pair`), as it pairs them with itself.
 *
 * The digest is bound to the bridge key, so a code offered to one bridge pairs nothing at another.
 * **Ending it is the patient's**, by a `revoked` assertion about their `paired_with` row (ADR-23
 * §5), after which nothing more is written for that subject until it pairs again.
 *
 * @module
 */

import { bytesToHex, randomBytes } from '@cosys/crypto';
import {
  MESSAGE_TYPE,
  openFromMailbox,
  pairingCodeDigest,
  syncEntrySchema,
  verifyAssertion,
  type DeviceIdentity,
  type Mailbox,
  type SyncEntry,
} from '@cosys/peer';
import { parseOrigin } from '@cosys/record/protocols';

import type { BridgeState } from './state.ts';

export { pairingCodeDigest };

/**
 * Offers a pairing for a subject: a fresh one-time code for the foreign side to print or show as a
 * QR, kept here only as its digest (`pairingCodeDigest`, `@cosys/peer`). The code is returned
 * once and stored nowhere by the bridge.
 */
export async function offerPairing(options: {
  readonly bridgeKey: string;
  readonly subject: string;
  readonly state: BridgeState;
  readonly expiresAt: number;
}): Promise<string> {
  const code = bytesToHex(randomBytes(16));
  await options.state.offerPairing(
    options.subject,
    pairingCodeDigest(options.bridgeKey, code),
    options.expiresAt,
  );
  return code;
}

/** Counts from applying the pairing assertions in one batch of rows. */
export interface PairingReport {
  /** Subjects paired by a `paired_with` assertion whose code was on offer. */
  readonly paired: number;
  /** Pairings ended by a `revoked` assertion from the patient who made them. */
  readonly unpaired: number;
  /** Assertions that did not verify, named another bridge, or whose code was not on offer. */
  readonly refused: number;
}

/** Applies the pairing assertions among `rows`, signed by patients, to the bridge's state. */
export async function acceptPairings(options: {
  readonly rows: readonly SyncEntry[];
  readonly bridgeKey: string;
  readonly state: BridgeState;
  readonly now?: number;
}): Promise<PairingReport> {
  const { rows, bridgeKey, state } = options;
  const now = options.now ?? Date.now();
  const report = { paired: 0, unpaired: 0, refused: 0 };
  for (const row of rows) {
    if (row.kind !== 'assert') continue;
    const verified = verifyAssertion(row, { receiver: bridgeKey, clinics: [], now });
    if (!('payload' in verified)) {
      report.refused += 1;
      continue;
    }
    const { signer, assertion } = verified.payload;
    if (assertion.claim === 'revoked') {
      const target = assertion.refs.find((ref) => ref.role === 'subject' && ref.kind === 'entry');
      if (target !== undefined && (await state.unpairByAssertion(target.to, signer)))
        report.unpaired += 1;
      else report.refused += 1;
      continue;
    }
    if (assertion.claim !== 'paired_with') continue;
    const aboutBridge = assertion.refs.some(
      (ref) => ref.role === 'subject' && ref.kind === 'key' && ref.to === bridgeKey,
    );
    const origins = assertion.refs.filter((ref) => ref.role === 'origin' && ref.kind === 'origin');
    const evidence = (assertion.evidence ?? []).filter((ref) => ref.kind === 'blob');
    const subject = origins.length === 1 ? parseOrigin(origins[0]!.to) : null;
    if (!aboutBridge || subject === null || evidence.length !== 1) {
      report.refused += 1;
      continue;
    }
    const subjectOrigin = origins[0]!.to;
    if (!(await state.claimOffer(subjectOrigin, evidence[0]!.to, now))) {
      report.refused += 1;
      continue;
    }
    await state.pair(subjectOrigin, signer, row.id);
    report.paired += 1;
  }
  return report;
}

/**
 * Collects the bridge's own mailbox: the frames patients deposited for it, opened with its key,
 * each row checked by `syncEntrySchema`, and the pairing assertions among them applied. Frames are
 * purged after they are applied, as every mailbox owner does (`mailbox.ts`). Returns the rows, so
 * a caller can apply what else arrived (an erasure request, PLAN M19-5).
 */
export async function collectInbound(options: {
  readonly identity: DeviceIdentity;
  readonly mailbox: Mailbox;
  readonly state: BridgeState;
  readonly now?: number;
}): Promise<{
  readonly rows: readonly SyncEntry[];
  readonly pairing: PairingReport;
  readonly unreadable: number;
}> {
  const rows: SyncEntry[] = [];
  let unreadable = 0;
  const waiting = await options.mailbox.collect();
  for (const item of waiting) {
    try {
      const delivery = await openFromMailbox(
        options.identity,
        (async function* () {
          yield item.blob;
        })(),
      );
      const sender = bytesToHex(delivery.senderIdentityKey);
      for await (const message of delivery.messages) {
        if (message.type !== MESSAGE_TYPE.batch) continue;
        for (const raw of message.body.rows) {
          const parsed = syncEntrySchema.safeParse(raw);
          // A row is believed only from the patient who deposited the frame it came in.
          if (parsed.success && signerOf(parsed.data) === sender) rows.push(parsed.data);
          else unreadable += 1;
        }
      }
    } catch {
      unreadable += 1;
    }
  }
  const bridgeKey = bytesToHex(options.identity.publicKey);
  const pairing = await acceptPairings({
    rows,
    bridgeKey,
    state: options.state,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  if (waiting.length > 0) await options.mailbox.purgeCollected(waiting.map((item) => item.receipt));
  return { rows, pairing, unreadable };
}

/** The key a patient's row says signed it: an assertion's signer, or an erasure request's requester. */
function signerOf(row: SyncEntry): string | null {
  try {
    const payload = JSON.parse(row.payload) as { signer?: unknown; requester?: unknown };
    if (row.kind === 'assert' && typeof payload.signer === 'string') return payload.signer;
    if (row.kind === 'erasure_request' && typeof payload.requester === 'string')
      return payload.requester;
  } catch {
    return null;
  }
  return null;
}
