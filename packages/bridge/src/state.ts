/**
 * What a bridge remembers between runs: the {@link BridgeState} interface, the plain data behind
 * it, and an in-memory store.
 * @module
 */

import type { Received } from './inbox.ts';

/**
 * What a bridge remembers between runs (ADR-22 §2): which origins it has written, and the rows
 * it wrote for each, so a second run or a second copy of one foreign object writes nothing; which
 * foreign subject is which paired patient; and the items it is waiting on.
 *
 * **Deduplication is by origin**, as NIP-48's `proxy` tag deduplicates for Mostr. An origin is
 * the foreign identifier verbatim, so the same result exported twice, or fetched by two runs, is
 * one row. A corrected result is a new foreign object with a new identifier or version, and is
 * written as a new row beside the old, never over it.
 *
 * The production store is the service's (a file on the bridge's volume); this interface is what
 * the loop needs and the memory store is what the tests use.
 */
export interface BridgeState {
  /** The row ids written for `origin`, or `undefined` if the bridge has written nothing for it. */
  rowsFor(origin: string): Promise<readonly string[] | undefined>;
  /** That `rowIds` were written for `origin`, to `patient`, so an erasure can find them. */
  remember(origin: string, rowIds: readonly string[], patient: string): Promise<void>;
  /** The patient's key for a foreign subject, recorded when that patient paired with the bridge. */
  patientOf(subject: string): Promise<string | undefined>;
  /**
   * Pairs a subject with a patient: from a verified pairing assertion (`pairing.ts`), whose row id
   * is kept so the patient can revoke it, or directly by a clinic that knows its own patients.
   */
  pair(subject: string, patient: string, assertionId?: string): Promise<void>;
  /** Ends the pairing that `assertionId` made, if `patient` made it. */
  unpairByAssertion(assertionId: string, patient: string): Promise<boolean>;
  /** Records a one-time pairing code's digest the foreign side offered for a subject. */
  offerPairing(subject: string, digest: string, expiresAt: number): Promise<void>;
  /** Spends an offered code: true once, for that subject, before it expires. */
  claimOffer(subject: string, digest: string, now: number): Promise<boolean>;
  /**
   * The codes still open, as their digests with their end, for the bridge's signed record: the
   * provisioning service opens one intake deposit for each (ADR-22 §4, `service/tick.ts`).
   */
  openOffers(
    now: number,
  ): Promise<readonly { readonly digest: string; readonly expiresAt: number }[]>;
  /** Every patient paired with this bridge now, by key: who may deposit to it. */
  patients(): Promise<readonly string[]>;
  /** Every item held for the next run. */
  deferred(): Promise<readonly Received<unknown>[]>;
  /** Holds an item for the next run, with the subject it is for when the codec knew it. */
  defer(item: Received<unknown>, reason: string, subject?: string): Promise<void>;
  /** Stops holding the item with this key, if one is held. */
  undefer(key: string): Promise<void>;
  /**
   * An erasure (PLAN M19-5): drops everything the bridge holds about `patient` and returns what it
   * dropped. The record of which origins it wrote for them, every subject paired with them, and
   * every deferred item for those subjects. The bridge keeps no copy of a row it sent, so this is
   * the whole of it.
   */
  forget(
    patient: string,
  ): Promise<{ readonly rowIds: readonly string[]; readonly deferred: number }>;
  /** Whether a request was answered, so a re-delivered one is answered once (ADR-17 §4). */
  answered(requestId: string): Promise<boolean>;
  /** Records that a request has been answered. */
  markAnswered(requestId: string): Promise<void>;
}

/**
 * What a bridge's state is made of, as plain data: what the memory store holds and what the file
 * store (`service/file-state.ts`) writes to the bridge's volume after every change.
 */
export interface StateData {
  /** The format version; 1 is the only one. */
  readonly version: 1;
  /** The row ids written for each origin, and the patient they went to. */
  written: Record<string, { readonly rowIds: readonly string[]; readonly patient: string }>;
  /** The ids of the erasure requests answered. */
  answered: string[];
  /** The patient's key for each paired foreign subject. */
  subjects: Record<string, string>;
  /** Pairings made by an assertion, by that assertion's row id, so the patient can revoke them. */
  byAssertion: Record<string, { readonly subject: string; readonly patient: string }>;
  /**
   * The pairing codes on offer, by digest, with their subject and expiry in milliseconds since the
   * epoch.
   */
  offers: Record<string, { readonly subject: string; readonly expiresAt: number }>;
  /** The deferred items, by their inbox key, with their subject when the codec knew it. */
  waiting: Record<string, { readonly item: Received<unknown>; readonly subject?: string }>;
}

/** A new, empty state at version 1. */
export function emptyStateData(): StateData {
  return {
    version: 1,
    written: {},
    answered: [],
    subjects: {},
    byAssertion: {},
    offers: {},
    waiting: {},
  };
}

/** A bridge state held in memory only and lost when the process ends; what the tests use. */
export function createMemoryState(): BridgeState {
  return stateOver(emptyStateData(), async () => {});
}

/** A bridge state over `data`, calling `saved` after each change has been made to it. */
export function stateOver(data: StateData, saved: (data: StateData) => Promise<void>): BridgeState {
  const changed = () => saved(data);
  return {
    forget: async (patient) => {
      const rowIds: string[] = [];
      for (const [origin, entry] of Object.entries(data.written)) {
        if (entry.patient !== patient) continue;
        rowIds.push(...entry.rowIds);
        delete data.written[origin];
      }
      const theirs = new Set(
        Object.entries(data.subjects)
          .filter(([, who]) => who === patient)
          .map(([subject]) => subject),
      );
      for (const subject of theirs) delete data.subjects[subject];
      for (const [id, made] of Object.entries(data.byAssertion))
        if (made.patient === patient) delete data.byAssertion[id];
      let deferred = 0;
      for (const [key, held] of Object.entries(data.waiting)) {
        if (held.subject !== undefined && theirs.has(held.subject)) {
          delete data.waiting[key];
          deferred += 1;
        }
      }
      await changed();
      return { rowIds, deferred };
    },
    answered: async (requestId) => data.answered.includes(requestId),
    markAnswered: async (requestId) => {
      if (!data.answered.includes(requestId)) data.answered.push(requestId);
      await changed();
    },
    pair: async (subject, patient, assertionId) => {
      data.subjects[subject] = patient;
      if (assertionId !== undefined) data.byAssertion[assertionId] = { subject, patient };
      await changed();
    },
    unpairByAssertion: async (assertionId, patient) => {
      const made = data.byAssertion[assertionId];
      if (made === undefined || made.patient !== patient) return false;
      delete data.byAssertion[assertionId];
      if (data.subjects[made.subject] === patient) delete data.subjects[made.subject];
      await changed();
      return true;
    },
    offerPairing: async (subject, digest, expiresAt) => {
      data.offers[digest] = { subject, expiresAt };
      await changed();
    },
    openOffers: async (now) =>
      Object.entries(data.offers)
        .filter(([, offer]) => offer.expiresAt >= now)
        .map(([digest, offer]) => ({ digest, expiresAt: offer.expiresAt })),
    patients: async () => [...new Set(Object.values(data.subjects))],
    claimOffer: async (subject, digest, now) => {
      const offer = data.offers[digest];
      if (offer === undefined || offer.subject !== subject || offer.expiresAt < now) return false;
      delete data.offers[digest];
      await changed();
      return true;
    },
    rowsFor: async (origin) => data.written[origin]?.rowIds,
    remember: async (origin, rowIds, patient) => {
      data.written[origin] = {
        rowIds: [...(data.written[origin]?.rowIds ?? []), ...rowIds],
        patient,
      };
      await changed();
    },
    patientOf: async (subject) => data.subjects[subject],
    deferred: async () => Object.values(data.waiting).map((held) => held.item),
    defer: async (item, _reason, subject) => {
      data.waiting[item.key] = subject === undefined ? { item } : { item, subject };
      await changed();
    },
    undefer: async (key) => {
      delete data.waiting[key];
      await changed();
    },
  };
}
