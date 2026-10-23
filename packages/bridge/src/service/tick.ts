/**
 * A bridge run as a service: {@link tick} does one whole scheduled run, and {@link offer} issues a
 * pairing code.
 * @module
 */

import type { DeviceIdentity, SyncEntry } from '@cosys/peer';

import type { Codec } from '../codec.ts';
import { answerErasures, type ErasureReport } from '../erasure.ts';
import type { Inbox } from '../inbox.ts';
import { runOnce, type RunReport } from '../loop.ts';
import { createOutbox } from '../outbox.ts';
import { collectInbound, offerPairing, type PairingReport } from '../pairing.ts';
import type { BridgeState } from '../state.ts';
import { bridgeKeyOf, type BridgeNetwork } from './network.ts';

/**
 * One run of a bridge as a service (ADR-22 §2, PLAN M19): everything it does on a schedule, in the
 * order that keeps a patient's first message from waiting a run.
 *
 * 1. **Collect** the intake group and every paired patient's mailbox: pairings are applied as they
 *    are read (`collectInbound`), and whatever else came is kept for step 2.
 * 2. **Answer erasures** among what came, before anything is written for the patient asking.
 * 3. **Run the loop** over the foreign inbox: write what is paired, wait for what is not.
 * 4. **Publish** the bridge's record: who may deposit to it now, and the codes still open.
 */
export interface TickOptions<Foreign> {
  /** The bridge's identity: its key signs the rows and opens what patients deposit for it. */
  readonly identity: DeviceIdentity;
  /** Which running copy this is, for the instance signature. */
  readonly instance: string;
  /** The estate's services, as the bridge reaches them. */
  readonly network: BridgeNetwork;
  /** What the bridge remembers between runs. */
  readonly state: BridgeState;
  /** Where foreign items arrive. */
  readonly inbox: Inbox<Foreign>;
  /** Translates foreign items into rows. */
  readonly codec: Codec<Foreign>;
  /** The operator's statement of what the foreign side keeps, for every erasure receipt. */
  readonly foreignKeeps: string;
  /** The bridge's backup window, as its directory entry states it. */
  readonly backupWindowDays: number;
  /** How many days an item may wait before it is refused; `DEFER_FOR_DAYS` when absent. */
  readonly deferForDays?: number;
  /** The clock, in milliseconds since the epoch; `Date.now` when absent. */
  readonly now?: () => number;
}

/** What one run did, step by step. */
export interface TickReport {
  /** Pairings applied while collecting, summed over every mailbox. */
  readonly pairing: PairingReport;
  /** Frames that could not be opened, and rows that failed their check, across every mailbox. */
  readonly unreadable: number;
  /** The erasure requests answered or ignored. */
  readonly erasures: ErasureReport;
  /** What the loop did with the foreign items. */
  readonly loop: RunReport;
}

/**
 * Runs a bridge once: collect, answer erasures, run the loop, publish, in the order
 * {@link TickOptions} gives.
 */
export async function tick<Foreign>(options: TickOptions<Foreign>): Promise<TickReport> {
  const now = options.now ?? Date.now;
  const { identity, network, state } = options;
  const outbox = createOutbox({
    identity,
    instance: options.instance,
    addressOf: (patient) => network.addressOf(patient),
    depositTo: (patient) => network.depositTo(patient),
    now: () => new Date(now()),
  });

  const rows: SyncEntry[] = [];
  const pairing = { paired: 0, unpaired: 0, refused: 0 };
  let unreadable = 0;
  for (const mailbox of network.inbound(await state.patients())) {
    const collected = await collectInbound({ identity, mailbox, state, now: now() });
    rows.push(...collected.rows);
    unreadable += collected.unreadable;
    pairing.paired += collected.pairing.paired;
    pairing.unpaired += collected.pairing.unpaired;
    pairing.refused += collected.pairing.refused;
  }

  const erasures = await answerErasures({
    rows,
    identity,
    state,
    outbox,
    foreignKeeps: options.foreignKeeps,
    backupWindowDays: options.backupWindowDays,
    now: () => new Date(now()),
  });

  const loop = await runOnce({
    inbox: options.inbox,
    codec: options.codec,
    outbox,
    state,
    ...(options.deferForDays === undefined ? {} : { deferForDays: options.deferForDays }),
    now,
  });

  await network.publish(await state.patients(), await state.openOffers(now()));
  return { pairing, unreadable, erasures, loop };
}

/**
 * A one-time pairing code for one foreign subject, to print on that subject's report (PLAN
 * M19-3). The code is returned once, to the operator's tooling, and kept only as its digest; the
 * record is published at once, so the code opens the intake before the next run.
 */
export async function offer(options: {
  readonly identity: DeviceIdentity;
  readonly network: BridgeNetwork;
  readonly state: BridgeState;
  readonly subject: string;
  readonly days: number;
  readonly now?: () => number;
}): Promise<string> {
  const now = (options.now ?? Date.now)();
  const code = await offerPairing({
    bridgeKey: bridgeKeyOf(options.identity),
    subject: options.subject,
    state: options.state,
    expiresAt: now + options.days * 86_400_000,
  });
  await options.network.publish(
    await options.state.patients(),
    await options.state.openOffers(now),
  );
  return code;
}
