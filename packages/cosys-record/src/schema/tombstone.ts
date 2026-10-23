/**
 * The tombstone's payload: how a delete is written as an insert that names the row it hides.
 *
 * @module
 */

import { z } from 'zod';

import { isoTimestamp, ulidRef } from './common.ts';

/**
 * ADR-02 §1: a delete is an insert. The tombstone names the row it hides; nothing is ever
 * removed from `entries` except by `purge`.
 */
export const tombstonePayloadSchema: z.ZodObject<
  {
    targetId: z.ZodString;
    targetKind: z.ZodString;
    targetOccurredAt: z.ZodOptional<z.ZodISODateTime>;
  },
  z.core.$strict
> = z.strictObject({
  targetId: ulidRef,
  /** The kind of the row being hidden, kept so a tombstone is readable on its own. */
  targetKind: z.string().min(1).max(40),
  /**
   * When the hidden row happened, for the same reason `targetKind` is here: a tombstone has to
   * be readable on its own.
   *
   * A share scoped to a period has to decide whether a retraction is in scope, and the only
   * honest answer is the one about the row being retracted — a tombstone's own `occurred_at` is
   * the moment of deletion, which is always later and frequently outside the period. Without
   * this field the grant either drops the retraction, which leaves a deleted reading on a peer's
   * phone for good, or sends it regardless, which leaks the deleted row's creation time in the
   * ULID it names. Neither is acceptable, and both were the behaviour before 2026-09-21.
   *
   * Optional because rows written before this field existed do not have it. `grants.ts` treats
   * its absence as "in scope", which is the safe direction: a retraction that travels when it
   * need not is inert on the receiver, and one that does not travel is a lie on their screen.
   */
  targetOccurredAt: isoTimestamp.optional(),
});

/** A tombstone's payload as parsed. */
export type TombstonePayload = z.infer<typeof tombstonePayloadSchema>;
