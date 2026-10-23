import { resolveErasures } from './erasure.ts';
import { resolveGrantState } from './grants.ts';
import type { SyncEntry } from './messages.ts';

/**
 * Who may deposit into this account's mailboxes: the `deposits` list its directory record
 * publishes, and the only thing the server checks before minting a deposit token (ADR-16
 * §Open questions, the allowlist's lifecycle; founder, 2026-09-24).
 *
 * ## The rule
 *
 * A paired peer stays on the list **unless** this account ended its share with them, and then
 * only for as long as an erasure request addressed to them is waiting on an answer:
 *
 * - **A live share, or none yet**: stays. `none` is a pairing whose grant has not been written
 *   yet, and refusing its deposits would break the pairing half-way.
 * - **Ended with `stop_sending`**: off at the next sync. ADR-16 §1's farewell travels from the
 *   patient to the peer, into the *peer's* mailbox, and nothing comes back: the peer has no
 *   acknowledgement to send and no rows of its own to deliver here. A window would be a door
 *   left open for nothing.
 * - **Ended with `stop_and_remove`**, which the relationship screen issues as a revocation plus
 *   an erasure request (ADR-17 §3): stays until that peer's receipt has arrived, because the
 *   receipt comes back through this mailbox and removing the depositor first would refuse the
 *   one answer the patient asked for. Off at the first sync after it lands.
 * - **No answer within {@link DEPOSIT_ANSWER_WINDOW_DAYS} days**: off anyway. The request stays
 *   `overdue` on the relationship screen, which is ADR-17 §6's visible miss; this only stops the
 *   door staying open for an answer that can no longer come.
 *
 * The same holds for an erasure asked long after a share ended (§3's second case): the request
 * reopens the door for its answer and the answer, or the window, closes it again.
 *
 * ## A held account keeps every peer
 *
 * It ends nothing (ADR-18 §7), and the one peer it has is the patient, who may send an erasure
 * request at any time, including long after she stopped sharing. Its list is its paired peers.
 *
 * ## What this does not do
 *
 * Frames a peer deposited **before** it left the list stay collectable (ADR-16 §Spike results
 * 3), and the collector still drains every paired peer's mailbox: a receipt deposited on the
 * last day of the window and collected the day after is still the patient's evidence. What
 * removal stops is the next token.
 */
export const DEPOSIT_ANSWER_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `deposits` list this account's directory record should publish: the `paired` peers, minus
 * any whose share this account ended, unless an erasure request to that peer is still waiting on
 * its receipt within {@link DEPOSIT_ANSWER_WINDOW_DAYS} days. An account that does not author
 * these rows (`authorsOwn: false`, a held account) keeps every paired peer.
 */
export function depositAllowlist(
  rows: Iterable<SyncEntry>,
  paired: readonly string[],
  options: {
    /** `canAuthor(account)`: whether these rows are this account's own acts. */
    readonly authorsOwn: boolean;
    /** The clock, in epoch milliseconds. Defaults to `Date.now()`. */
    readonly now?: number;
  },
): readonly string[] {
  if (!options.authorsOwn) return [...paired];
  const all = [...rows];
  const now = options.now ?? Date.now();
  const erasures = resolveErasures(all, { now });

  return paired.filter((peer) => {
    if (resolveGrantState(all, peer, true).status !== 'revoked') return true;
    return erasures.some(
      (state) =>
        state.asked.peer === peer &&
        state.receipt === null &&
        now - Date.parse(state.asked.requestedAt) <= DEPOSIT_ANSWER_WINDOW_DAYS * DAY_MS,
    );
  });
}
