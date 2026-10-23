/**
 * The incidences of a row of this modality, for an app's incidence index.
 *
 * @module
 */
import { columnRefs, normaliseRefs, type Incidence } from '@cosys/record/refs';
import type { SyncEntry } from '@cosys/record/row';

import { isPostKind } from './kinds.ts';
import { parsePostPayload } from './schema.ts';

/**
 * The incidences of a row of this modality, as an app's `entry_refs` would hold them (ADR-23 §3):
 * what its columns and attachments name, and the refs its payload writes. In the substrate's one
 * order, so an index built from these is the index rebuilt from them. Empty for a row that is not
 * a valid one of this modality's, whose columns the app's own derivation already covers.
 */
export function postRefs(row: SyncEntry, attachments: readonly string[] = []): Incidence[] {
  if (!isPostKind(row.kind)) return [];
  const payload = parsePostPayload(row.kind, row.payload);
  if (payload === null) return [];
  return normaliseRefs([...columnRefs(row, attachments), ...payload.refs]);
}
