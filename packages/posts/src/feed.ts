/**
 * The feed: the rows of this modality addressed to a unit or to a cohort it is in, newest first,
 * read from an app's incidence index.
 *
 * @module
 */
import type { Incidence } from '@cosys/record/refs';

/**
 * The feed (ADR-24 §2): every row that names this unit, or a cohort it is in, as its audience,
 * newest first, with who wrote it. One query over the incidence index, which is what the handoff
 * meant by posts being cheap on this substrate: no table of their own, no server.
 *
 * `IncidenceIndex` is the part of an app's `entry_refs` the feed reads (TApp's `refsRepo.naming`
 * is the first method's shape). Which of these rows are still current, because a tombstone
 * retracted one or a supersede replaced it, is the app's `current_entries` to say, as for every
 * other row.
 */
export interface IncidenceIndex {
  /** Every row that names `to` under one of `roles`. */
  naming(
    to: string,
    roles: readonly string[],
  ): Promise<readonly { readonly entryId: string; readonly role: string }[]>;
  /** Every incidence one row has. */
  incidencesOf(entryId: string): Promise<readonly Incidence[]>;
}

/** One row in a feed and who wrote it. */
export interface FeedItem {
  /** The row's id, a ULID; the feed is ordered by it. */
  readonly entryId: string;
  /** The author's key. */
  readonly author: string;
}

/**
 * Every row addressed to `me` or to one of `cohorts`, each once, newest first by id, with its
 * author. A row the index holds no author for is left out. Whether each row is still current is
 * not decided here (see `IncidenceIndex`).
 */
export async function feedOf(
  index: IncidenceIndex,
  me: string,
  cohorts: readonly string[] = [],
): Promise<readonly FeedItem[]> {
  const ids = new Set<string>();
  for (const unit of [me, ...cohorts]) {
    for (const { entryId } of await index.naming(unit, ['audience'])) ids.add(entryId);
  }
  const items: FeedItem[] = [];
  for (const entryId of ids) {
    const author = (await index.incidencesOf(entryId)).find((ref) => ref.role === 'author');
    if (author !== undefined) items.push({ entryId, author: author.to });
  }
  return items.sort((a, b) => (a.entryId < b.entryId ? 1 : a.entryId > b.entryId ? -1 : 0));
}
