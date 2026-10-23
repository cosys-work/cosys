/**
 * The foreign face of a bridge (ADR-22 §1): whatever a protocol needs it to be, an HTTP endpoint
 * a lab posts to, a folder a lab's export lands in, a poller of an export URL. An inbox
 * authenticates what arrives the foreign way and yields it as **untrusted input**: nothing it
 * yields is believed until a codec has read it and the bridge has signed what the codec made.
 *
 * @module
 */

/** One foreign object, as it arrived. */
export interface Received<Foreign> {
  /**
   * The inbox's own name for the item, stable across runs: a deferred item is retried under it,
   * and an item that arrives again while deferred is the same item, not a second one.
   */
  readonly key: string;
  /** The item as the inbox parsed it, for the codec to read. Untrusted. */
  readonly object: Foreign;
  /** The object as the foreign side sent it, kept beside its translation (`bridge:import`). */
  readonly raw: { readonly mediaType: string; readonly text: string };
  /** When the inbox received it, as a date-time string; the loop's wait limit counts from here. */
  readonly receivedAt: string;
}

/** What became of an item, as the loop tells its inbox. */
export type Settlement = 'written' | 'duplicate' | 'deferred' | 'refused';

/** Where foreign items arrive for the loop, and where it reports what became of them. */
export interface Inbox<Foreign> {
  /** What has arrived since the last call. */
  take(): Promise<readonly Received<Foreign>[]>;
  /**
   * Told what became of each item: where an inbox answers its foreign side (an HTTP status, an
   * acknowledgement file), which is the loop's *respond* outcome. Optional: a folder needs none.
   */
  settle?(item: Received<Foreign>, outcome: Settlement, reason?: string): Promise<void>;
}

/** An inbox over a fixed list, for tests and for a one-off import run by hand. */
export function listInbox<Foreign>(items: readonly Received<Foreign>[]): Inbox<Foreign> & {
  readonly settled: readonly {
    readonly key: string;
    readonly outcome: Settlement;
    readonly reason?: string;
  }[];
} {
  let waiting = [...items];
  const settled: { key: string; outcome: Settlement; reason?: string }[] = [];
  return {
    settled,
    async take() {
      const taken = waiting;
      waiting = [];
      return taken;
    },
    async settle(item, outcome, reason) {
      settled.push(
        reason === undefined ? { key: item.key, outcome } : { key: item.key, outcome, reason },
      );
    },
  };
}
