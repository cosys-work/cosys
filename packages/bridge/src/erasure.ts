/**
 * Erasure requests to a bridge: {@link answerErasures} drops what the bridge holds for the
 * patient who asked and answers with a signed receipt.
 * @module
 */

import { bytesToHex } from '@cosys/crypto';
import {
  erasureRequestDigest,
  readErasureRequest,
  type DeviceIdentity,
  type SyncEntry,
} from '@cosys/peer';

import type { Outbox } from './outbox.ts';
import type { BridgeState } from './state.ts';

/**
 * Erasure through a bridge (ADR-17; ADR-22 §3; PLAN M19-5). A bridge is a holder: it learned which
 * foreign subject is which patient, which results it sent them, and it may be holding results that
 * wait for them. When the patient asks it to erase, it drops all of that (`BridgeState.forget`)
 * and answers with a `bridge:receipt` signed under its key, deposited to the patient as its rows are.
 *
 * **It erases everything it holds for the requester, whatever the scope says.** What a bridge
 * holds is bookkeeping about the patient, not their record, and keeping part of it would keep the
 * pairing; the receipt lists what went. **And it says what it cannot reach**: the foreign side's
 * own copy (the lab's record of its tests) is outside every receipt, as ADR-17's bounded claim
 * has it, and the operator's statement of that goes into every receipt, never left to be inferred.
 *
 * A request is answered once: a re-delivered one finds its answer recorded and is skipped.
 */
export interface ErasureOptions {
  /** Rows collected from the bridge's mailbox; only `erasure_request` rows are read. */
  readonly rows: readonly SyncEntry[];
  /** The bridge's identity: a request is answered only when it names this key. */
  readonly identity: DeviceIdentity;
  /** Where the requester's holdings are dropped and answered requests are recorded. */
  readonly state: BridgeState;
  /** Delivers each receipt to the patient who asked. */
  readonly outbox: Outbox;
  /** The operator's statement of what the foreign side keeps, in the words its consent text uses. */
  readonly foreignKeeps: string;
  /** The bridge's backup window, as its directory entry states it (ADR-17 §5). */
  readonly backupWindowDays: number;
  /** The clock for the receipt's times; the system clock when absent. */
  readonly now?: () => Date;
}

/**
 * Counts from one call to {@link answerErasures}. A re-delivered request that was already
 * answered counts in neither.
 */
export interface ErasureReport {
  /** Requests answered with a receipt in this call. */
  readonly answered: number;
  /** Requests addressed to another holder, or not signed by the patient they name. */
  readonly ignored: number;
}

/**
 * Answers each erasure request in `options.rows` that names this bridge: forgets everything held
 * for the requester, deposits a `bridge:receipt` listing the row ids dropped, and records the
 * request as answered.
 */
export async function answerErasures(options: ErasureOptions): Promise<ErasureReport> {
  const bridgeKey = bytesToHex(options.identity.publicKey);
  const now = options.now ?? (() => new Date());
  const report = { answered: 0, ignored: 0 };
  for (const row of options.rows) {
    if (row.kind !== 'erasure_request') continue;
    const asked = readErasureRequest(row);
    if (asked === null || asked.peer !== bridgeKey) {
      report.ignored += 1;
      continue;
    }
    if (await options.state.answered(row.id)) continue;
    const dropped = await options.state.forget(asked.requester);
    const at = now();
    await options.outbox.deliver(asked.requester, [
      {
        kind: 'bridge:receipt',
        occurredAt: at.toISOString(),
        body: {
          refs: [{ role: 'request', to: row.id, kind: 'entry' }],
          requestHash: erasureRequestDigest(row),
          purgedAt: at.toISOString(),
          purged: [...dropped.rowIds],
          backups: { retentionDays: options.backupWindowDays },
          foreignKeeps: options.foreignKeeps,
        },
      },
    ]);
    await options.state.markAnswered(row.id);
    report.answered += 1;
  }
  return report;
}
