/**
 * A row as it travels between units: the substrate's entry shape (the Cat Pub handoff's package
 * layout; moved here from `@cosys/peer`'s `messages.ts` on 2026-10-22).
 *
 * It lived in the peer package, which was right while only the peer package wrote rows for the
 * wire. A modality's projections write them too (`@tapp/record`'s `views.ts`), and a modality
 * cannot import the peer package: the peer package reads the modalities through the registries,
 * so the import would be a cycle. The shape is no modality's, so it is here, and `@cosys/peer`
 * re-exports it under the names it always had.
 *
 * @module
 */

import { z } from 'zod';

import { isKind } from './kinds.ts';

/** ADR-02 §5: provenance of every row. Moved from `@tapp/record`'s `schema/entries.ts`, which re-exports it. */
export const ENTRY_SOURCES = ['manual', 'photo_assisted', 'imported', 'system'] as const;

/** One of `ENTRY_SOURCES`: how a row came to be written. */
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** A ULID, or `settings`' name key. Same bound the backup's row schemas use. */
const id = z.string().min(1).max(64);
const timestamp = z.string().min(1).max(40);
const jsonText = z.string().max(64 * 1024);

/**
 * An entry as it travels.
 *
 * It is `entryRowSchema` from `src/data/backup/rows.ts` with one addition: a projected row
 * (§2) is an entry of a `view:*` kind, so the same merge handles it and the receiver's schema
 * stays strict. ~~**A schema migration is owed before this can be real** — `ENTRY_KINDS` in the
 * shipping app has no `view:*` member.~~ *Landed 2026-09-21 as migration `0006_`: `ENTRY_KINDS`
 * is now the union of the ten a patient authors, the three views and the four control kinds,
 * and `current_entries` excludes the control ones.*
 *
 * **The vocabulary is the app's, undecorated.** It used to be
 * `[...ENTRY_KINDS, ...VIEW_KINDS, ...CONTROL_KINDS]`, which was right when `ENTRY_KINDS` held
 * only the patient's ten and became five duplicates and one stale list the moment `0006_`
 * widened it — the local `CONTROL_KINDS` named `grant` and `revoke` and has never heard of
 * `erasure_request`. A vocabulary assembled by spreading three lists is a vocabulary that
 * silently disagrees with its source; deriving it means a kind added to the app is a kind this
 * schema already knows about.
 *
 * **What a row may *be* is not what a row may *travel*.** This schema is what a store can
 * express, because the local store holds every kind the app writes. Whether a grant may carry it
 * is the other question, and it is asked of every kind rather than of two by name
 * (`travelsUnderGrant`, in `kinds.ts`, which `@cosys/peer`'s `grants.ts` asks).
 *
 * *2026-10-21, the handoff's WP2:* **the vocabulary is the registry's**, not a list this package
 * imports. A kind is one some loaded modality registered with `@cosys/record/kinds`, and nothing
 * else; the health and clinic modalities register exactly `ENTRY_KINDS` (`@tapp/record`'s
 * `kinds.test.ts`), so what this refuses has not moved. The type is `string` because that is what
 * the substrate knows. An app accepts what the modalities it loads registered: TApp and the clinic
 * load the health and clinic modalities and no other, so for them this is `ENTRY_KINDS` still. An
 * app that loads another modality also takes on deciding whether its store holds those kinds.
 */
export const syncEntrySchema: z.ZodObject<
  {
    id: z.ZodString;
    kind: z.ZodString;
    occurredAt: z.ZodString;
    recordedAt: z.ZodString;
    deviceId: z.ZodString;
    source: z.ZodEnum<z.core.util.ToEnum<EntrySource>>;
    supersedesId: z.ZodNullable<z.ZodString>;
    targetId: z.ZodNullable<z.ZodString>;
    payload: z.ZodString;
    glucoseMgdl: z.ZodNullable<z.ZodInt>;
    aiModelId: z.ZodNullable<z.ZodString>;
    aiSuggestion: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
> = z.object({
  id,
  kind: z.string().max(81).refine(isKind, { message: 'a kind no loaded modality registered' }),
  occurredAt: timestamp,
  recordedAt: timestamp,
  deviceId: z.string().min(1).max(64),
  source: z.enum(ENTRY_SOURCES),
  supersedesId: id.nullable(),
  targetId: id.nullable(),
  payload: jsonText,
  glucoseMgdl: z.int().nullable(),
  aiModelId: z.string().max(120).nullable(),
  aiSuggestion: z
    .string()
    .max(64 * 1024)
    .nullable(),
});

/**
 * Two facts about a correction that the sender reads and never sends (ADR-16 §Open questions,
 * answered 2026-09-24; the app's migration `0010_`).
 *
 * A supersede names the row it replaces by id, and that is all the wire has ever carried. Under
 * a share, that is not enough to repair a peer's copy when the correction falls outside the
 * grant: the grant filter has to know whether the *replaced* row was inside it, synchronously,
 * and the store has its kind and `occurred_at` for exactly that purpose.
 *
 * **Not in `syncEntrySchema`, on purpose, in both directions.** Sending them would tell a peer
 * the kind of a row it may never have been entitled to see (a band-only peer learning that a
 * reading replaced a meal), so `toWireRow` strips them before any batch is encoded. And a peer
 * cannot supply them: the schema does not name them, so parsing an arriving row drops them, and
 * a received row can never masquerade as the patient's own correction.
 */
export interface LocalCorrectionFacts {
  /** The kind of the row this one supersedes; null or absent when unknown. */
  readonly supersededKind?: string | null;
  /** That row's `occurred_at`; null or absent when unknown. */
  readonly supersededOccurredAt?: string | null;
}

/**
 * A row as it travels, with the local correction facts a sender may hold beside it and never sends
 * (`toWireRow` strips them).
 */
export type SyncEntry = z.infer<typeof syncEntrySchema> & LocalCorrectionFacts;

/** The fields of `LocalCorrectionFacts`, which no encoded batch may carry. */
export const LOCAL_ONLY_FIELDS = ['supersededKind', 'supersededOccurredAt'] as const;

/**
 * A row as it may leave the device: every local-only field removed.
 *
 * Applied in `@cosys/peer`'s `encodeMessage`, which every path to a socket or a mailbox passes through (a live
 * session, a deposit, a receipt, a clinic outbox), so there is one place to get it right rather
 * than four to remember it in.
 */
export function toWireRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null) return row;
  const wire: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of LOCAL_ONLY_FIELDS) delete wire[field];
  return wire;
}
