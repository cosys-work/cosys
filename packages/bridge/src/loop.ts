/**
 * The bridge's actor loop: {@link runOnce} takes what waits and what has arrived, translates it
 * with a codec and deposits the rows, holding back what cannot be written yet.
 * @module
 */

import { originOfDraft, type Codec } from './codec.ts';
import type { Inbox, Received, Settlement } from './inbox.ts';
import type { Outbox } from './outbox.ts';
import type { BridgeState } from './state.ts';

/**
 * The actor loop (ADR-22 §1): inbox, codec, outbox, with the deferral rule. One run takes what
 * is waiting (the items deferred last time first, then what has arrived), and for each:
 *
 * 1. the codec reads it, and refuses it or defers it, or proposes rows for one foreign subject;
 * 2. the subject is looked up among the bridge's paired patients, and an unknown one is deferred,
 *    so a result that reaches the bridge before its patient pairs is held rather than lost or
 *    sent to nobody;
 * 3. rows whose origin the bridge has already written are dropped, and the rest are signed and
 *    deposited in one frame to that patient;
 * 4. the inbox is told what became of the item, which is where it answers its foreign side.
 *
 * Every step is idempotent by origin: a run that dies after depositing and before remembering
 * deposits again on the next run, and the patient's phone keeps one row per origin.
 */
export interface RunReport {
  /** Items whose rows were deposited. */
  readonly written: number;
  /** Rows deposited, across those items. */
  readonly rows: number;
  /** Items whose rows had all been written before. */
  readonly duplicate: number;
  /** Items held for a later run. */
  readonly deferred: number;
  /** Items refused: by the codec, because it threw, or for waiting past the limit. */
  readonly refused: number;
}

/** What one run of the loop works with. */
export interface LoopOptions<Foreign> {
  /** Where foreign items arrive; told how each was settled. */
  readonly inbox: Inbox<Foreign>;
  /** Translates each item into rows, a deferral or a refusal. */
  readonly codec: Codec<Foreign>;
  /** Signs the rows and deposits them to the patient. */
  readonly outbox: Outbox;
  /** The origins written, the pairings, and the items deferred. */
  readonly state: BridgeState;
  /**
   * How long an item may wait, from when it arrived, before it is dropped: 30 days unless
   * configured. A result whose subject never pairs is someone's lab data held by a bridge nobody
   * asked to hold it, so waiting has an end (2026-10-22, PLAN M19-5).
   */
  readonly deferForDays?: number;
  /** The clock, in milliseconds since the epoch; `Date.now` when absent. */
  readonly now?: () => number;
}

/** How many days an item may wait before it is refused, when `deferForDays` is not set. */
export const DEFER_FOR_DAYS = 30;

/**
 * Runs the loop once over the deferred items and what has newly arrived, settles each, and
 * returns the counts. An item under the same key in both is taken once, as it newly arrived.
 */
export async function runOnce<Foreign>(options: LoopOptions<Foreign>): Promise<RunReport> {
  const { inbox, codec, outbox, state } = options;
  const report = { written: 0, rows: 0, duplicate: 0, deferred: 0, refused: 0 };
  const items = new Map<string, Received<Foreign>>();
  for (const item of (await state.deferred()) as readonly Received<Foreign>[])
    items.set(item.key, item);
  for (const item of await inbox.take()) items.set(item.key, item);

  const now = (options.now ?? Date.now)();
  const waitLimit = (options.deferForDays ?? DEFER_FOR_DAYS) * 86_400_000;
  const settle = async (
    item: Received<Foreign>,
    outcome: Settlement,
    reason?: string,
    subject?: string,
  ) => {
    if (outcome === 'deferred' && now - Date.parse(item.receivedAt) > waitLimit) {
      return settle(
        item,
        'refused',
        `waited more than ${options.deferForDays ?? DEFER_FOR_DAYS} days: ${reason ?? ''}`,
      );
    }
    if (outcome === 'deferred') await state.defer(item, reason ?? '', subject);
    else await state.undefer(item.key);
    report[outcome === 'written' ? 'written' : outcome] += 1;
    await inbox.settle?.(item, outcome, reason);
  };

  for (const item of items.values()) {
    let decoded;
    try {
      decoded = codec.decode(item);
    } catch {
      await settle(item, 'refused', 'the codec could not read it');
      continue;
    }
    if (decoded.outcome === 'refuse') {
      await settle(item, 'refused', decoded.reason);
      continue;
    }
    if (decoded.outcome === 'defer') {
      await settle(item, 'deferred', decoded.reason, decoded.subject);
      continue;
    }
    const patient = await state.patientOf(decoded.subject);
    if (patient === undefined) {
      await settle(item, 'deferred', 'no paired patient for that subject yet', decoded.subject);
      continue;
    }
    const fresh = [];
    for (const draft of decoded.rows) {
      const origin = originOfDraft(draft);
      if (origin === null || (await state.rowsFor(origin)) === undefined) fresh.push(draft);
    }
    if (fresh.length === 0) {
      await settle(item, 'duplicate');
      continue;
    }
    const rows = await outbox.deliver(patient, fresh);
    for (const [index, row] of rows.entries()) {
      const origin = originOfDraft(fresh[index]!);
      if (origin !== null) await state.remember(origin, [row.id], patient);
    }
    report.rows += rows.length;
    await settle(item, 'written');
  }
  return report;
}
