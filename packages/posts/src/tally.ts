/**
 * Counting a post's votes into an up and a down total, with no way to compare two posts.
 *
 * @module
 */
import type { SyncEntry } from '@cosys/record/row';

import { authorOf, citesOf, parsePostPayload, type VotePayload } from './schema.ts';

/**
 * A post's votes, counted (founder, 2026-10-22, ADR-24 §7 amending §6): **totals are shown, and
 * nothing is ordered by them.** A feed is in time order whatever its votes say, so this returns
 * two numbers for one post and has no way to compare two posts. Each voter counts once, by their
 * latest vote; a vote another row superseded or retracted is the caller's `current_entries` to
 * leave out, as for every row.
 */
export interface Tally {
  /** How many voters' latest vote is up. */
  readonly up: number;
  /** How many voters' latest vote is down. */
  readonly down: number;
  /** This reader's own vote, when they have cast one. */
  readonly mine: 'up' | 'down' | null;
}

/**
 * The votes on `post` among `votes`, as `me` reads them. Rows that are not votes on `post` are
 * skipped, and each voter counts once, by their vote with the latest id.
 */
export function tallyOf(post: string, votes: readonly SyncEntry[], me: string): Tally {
  const latest = new Map<string, { readonly id: string; readonly vote: 'up' | 'down' }>();
  for (const row of votes) {
    if (row.kind !== 'public:vote') continue;
    const payload = parsePostPayload('public:vote', row.payload) as VotePayload | null;
    if (payload === null || !citesOf(payload).includes(post)) continue;
    const voter = authorOf(payload);
    const seen = latest.get(voter);
    if (seen === undefined || row.id > seen.id)
      latest.set(voter, { id: row.id, vote: payload.vote });
  }
  let up = 0;
  let down = 0;
  for (const { vote } of latest.values()) {
    if (vote === 'up') up += 1;
    else down += 1;
  }
  return { up, down, mine: latest.get(me)?.vote ?? null };
}
