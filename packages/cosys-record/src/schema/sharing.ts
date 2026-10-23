/**
 * The payloads of the substrate's acts about sharing: a grant, a revocation, an erasure request
 * and its receipt (ADR-16, ADR-17). Moved here from `@tapp/record`'s `schema/payloads/sharing.ts`
 * on 2026-10-22, which re-exports them under the same names.
 *
 * The kinds were the substrate's since the registries (WP2); their shapes were still the health
 * modality's, because each named the health vocabulary: a grant's views were an enum of the health
 * views, a scope's kinds an enum of the patient's kinds, a receipt's kept categories an enum of the
 * clinic's. Each of those is now a question to a registry, asked at parse time, so a modality loaded
 * beside health and the clinic is answered the same way and the substrate names none of them.
 * **What each refuses has not moved**: for the health and clinic modalities the registries hold
 * exactly the old enums, and `@tapp/record`'s `sharing.test.ts` holds them to it.
 *
 * Every one of them is parsed on arrival from a peer. AGENTS.md rule 7 treats a `.tappbak` as
 * untrusted input because "the AEAD proves nobody edited it after it was written; it proves
 * nothing about what wrote it" — and a peer is strictly worse than a file, because a file at
 * least came from the patient.
 *
 * **Strict, like every other payload.** A field nobody expected is rejected rather than stripped,
 * which keeps a silent loss from looking like a successful parse. The cost is that a row from a
 * newer build with a new field does not parse on an older one; the protocol has no version
 * negotiation by design (ADR-14 §3), so the visible failure is the better one.
 *
 * @module
 */

import { z } from 'zod';

import { isControlKind, travelsUnderGrant } from '../kinds.ts';
import { isView, isViewKind } from '../views.ts';

/** A device's long-term identity key, lowercase hex. Verified at pairing, never taken on trust. */
export const peerKeyHex: z.ZodString = z.string().regex(/^[0-9a-f]{64}$/);

/** What a patient may narrow a share to. ISO 8601, compared as instants rather than as text. */
const periodBound = z.string().max(40);

/**
 * What a revocation's scope may name: everything a receiving device can be holding of the
 * patient's. A kind that travels and is not an act about sharing. For the health modality that is
 * the patient's own kinds, which a full peer holds, and the views, which the narrower peers hold
 * instead: `REVOCABLE_KINDS`. The tombstone is in both lists and so here, though naming it scopes
 * nothing: a retraction is scoped by the row it retracts (`@cosys/peer`'s `grants.ts`).
 */
export function isRevocableKind(kind: string): boolean {
  return travelsUnderGrant(kind) && !isControlKind(kind);
}

/**
 * What a grant's scope may name: a revocable kind that is a record rather than a projection. A
 * grant filters the patient's own log *before* any projection runs, so a view's kind here would
 * be asking to filter on a row that does not exist yet. For the health modality, the patient's
 * own kinds: `PATIENT_ENTRY_KINDS`.
 */
export function isGrantScopeKind(kind: string): boolean {
  return isRevocableKind(kind) && !isViewKind(kind);
}

const kindName = z.string().max(81);

/** A share, as an act with a scope (ADR-16 §3). */
export const grantPayloadSchema: z.ZodObject<
  {
    peer: z.ZodString;
    view: z.ZodString;
    kinds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    attachments: z.ZodBoolean;
    alsoViews: z.ZodOptional<z.ZodArray<z.ZodString>>;
    emergency: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strict
> = z.strictObject({
  peer: peerKeyHex,
  /** A view some loaded modality registered (`views.ts`), or the substrate's `full`. */
  view: z.string().max(40).refine(isView, { message: 'a view no loaded modality registered' }),
  /** Entry kinds in scope. Absent means every kind the view admits. */
  kinds: z
    .array(kindName.refine(isGrantScopeKind, { message: 'not a kind a grant can scope by' }))
    .max(40)
    .optional(),
  from: periodBound.optional(),
  to: periodBound.optional(),
  /** Whether attachment bytes travel. A lab report is a different decision from its row. */
  attachments: z.boolean(),
  /**
   * Further views sent alongside `view`, for a level that is more than one projection (PLAN
   * M11 F05: *Band* is the band view and the medicines-taken view). Every view here must read a
   * different kind from `view` and from each other, so that one row still produces at most one
   * projected row; `@cosys/peer`'s `grants.ts` refuses a combination that does not. Optional, so
   * every grant written before it parses unchanged.
   */
  alsoViews: z
    .array(z.string().max(40).refine(isView, { message: 'a view no loaded modality registered' }))
    .max(4)
    .optional(),
  /**
   * The patient marked this person an emergency contact (PLAN M11 F03b, founder D4). Only these
   * are poked when a reading past a default line is deposited for them, and only their phones
   * raise a notification for it. Separate from the level: a caregiver far away can be on Exact
   * and not be one. Absent means no, so every grant written before it is unchanged.
   */
  emergency: z.boolean().optional(),
});

/** A grant's payload as parsed. */
export type GrantPayload = z.infer<typeof grantPayloadSchema>;

/**
 * How a revocation ends sharing. With `stop_sending` the receiver keeps what it was given; with
 * `stop_and_remove` it also deletes the rows in scope and their attachments.
 */
export const REVOCATION_MODES = ['stop_sending', 'stop_and_remove'] as const;

/** One of `REVOCATION_MODES`. */
export type RevocationMode = (typeof REVOCATION_MODES)[number];

/**
 * What a revocation reaches (ADR-16 §1).
 *
 * Named by properties a receiving device can evaluate against rows it holds — which log they
 * came from, what kind they are, when they happened. A scope referring to a grant id would need
 * the peer to have been told about grants, and a grant is the patient's business.
 */
export const revocationScopeSchema: z.ZodObject<
  {
    deviceIds: z.ZodArray<z.ZodString>;
    kinds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
  },
  z.core.$strict
> = z.strictObject({
  deviceIds: z.array(z.string().min(1).max(64)).min(1).max(64),
  /**
   * Wider than the grant's, because this one is evaluated by the receiver against rows the
   * receiver holds — and on a band peer those rows are `view:glucose_band`.
   */
  kinds: z
    .array(kindName.refine(isRevocableKind, { message: 'not a kind a revocation can scope by' }))
    .max(40)
    .optional(),
  from: periodBound.optional(),
  to: periodBound.optional(),
});

/** A revocation's scope as parsed. */
export type RevocationScope = z.infer<typeof revocationScopeSchema>;

/** A revocation: its mode, the peer it is addressed to (absent for every peer), and its scope. */
export const revocationPayloadSchema: z.ZodObject<
  {
    mode: z.ZodEnum<z.core.util.ToEnum<RevocationMode>>;
    peer: z.ZodOptional<z.ZodString>;
    scope: typeof revocationScopeSchema;
  },
  z.core.$strict
> = z.strictObject({
  mode: z.enum(REVOCATION_MODES),
  /** Absent means every peer, which is "stop sharing with everyone" and stays expressible. */
  peer: peerKeyHex.optional(),
  scope: revocationScopeSchema,
});

/** A revocation's payload as parsed. */
export type RevocationPayload = z.infer<typeof revocationPayloadSchema>;

/**
 * A request that a peer destroy what it holds, and the peer's answer (ADR-17).
 *
 * **Amended 2026-09-23** (ADR-17 §9), when the feature was built on top of them. Both rows carry
 * an Ed25519 signature over their own content, and the receipt carries what §4 lists: the request
 * by id *and* by hash, the scope as the holder read it, what is left, and who answered.
 *
 * **Why a signature on the row when the frame is already authenticated.** The mailbox frame
 * proves who sealed it, and that proof is gone the moment the frame is opened and purged. A
 * receipt is kept for months as the patient's evidence (§8 finding 3), and evidence that
 * depends on a frame nobody kept is not evidence. So the statement signs itself.
 *
 * **A receipt is excluded from nothing.** ADR-17 §8 finding 3: it is the patient's only durable
 * evidence that they asked and were answered, and the Act gives them three months to act on it,
 * so it is in `.tappbak` and it is removed only by `purge`.
 */

/** An Ed25519 signature, lowercase hex. */
export const signatureHex: z.ZodString = z.string().regex(/^[0-9a-f]{128}$/);

/** A SHA-256 digest, lowercase hex. */
export const digestHex: z.ZodString = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * An erasure request: the holder it is addressed to, the requester whose key signs it, the scope,
 * when it was made, and the requester's signature.
 */
export const erasureRequestPayloadSchema: z.ZodObject<
  {
    peer: z.ZodString;
    requester: z.ZodString;
    scope: typeof revocationScopeSchema;
    requestedAt: z.ZodString;
    signature: z.ZodString;
  },
  z.core.$strict
> = z.strictObject({
  /** The holder the request is addressed to. A clinic is a peer (ADR-17 §3). */
  peer: peerKeyHex,
  /** Whose request it is. The signature verifies against this key and no other. */
  requester: peerKeyHex,
  scope: revocationScopeSchema,
  requestedAt: z.string().max(40),
  signature: signatureHex,
});

/** An erasure request's payload as parsed. */
export type ErasureRequestPayload = z.infer<typeof erasureRequestPayloadSchema>;

/**
 * Who answered, which decides what the receipt has to say.
 *
 * `install` is an app on somebody's phone. It keeps no backups of its own, so it has no window
 * to state. `archive` is the holder of ADR-17 §1 that does keep backups, and §5 makes the
 * operator's actual retention window **mandatory** in every receipt it signs.
 */
export const ERASURE_HOLDERS = ['install', 'archive'] as const;

/** One of `ERASURE_HOLDERS`. */
export type ErasureHolder = (typeof ERASURE_HOLDERS)[number];

/** Whether the holder did all of what was asked. A partial answer beats silence (§6). */
export const ERASURE_OUTCOMES = ['complete', 'partial'] as const;

/** One of `ERASURE_OUTCOMES`. */
export type ErasureOutcome = (typeof ERASURE_OUTCOMES)[number];

/** ADR-16 §1's sentence, which every receipt carries rather than implies. */
export const BEYOND_REACH = 'exports, copies and anything written down' as const;

/**
 * What a holder may keep of its own when it honours an erasure, by category, and for how long at
 * least (ADR-20 §9; ADR-17 §5's category "anything the clinic derived"). The categories are a
 * modality's: the clinic's are its signed rows, the pairing record, the consent and the audit
 * log, which the NMC's Code of Ethics keeps five years (`@tapp/record`'s `KEPT_CATEGORIES`). A
 * bridge's will name what a foreign network keeps (ADR-22, PLAN M19-5). Registered here, as kinds
 * are, so a receipt names only categories some loaded modality defined.
 */
const keptCategories = new Map<
  string,
  { readonly modality: string; readonly minRetentionYears: number }
>();

/**
 * Adds a modality's kept categories, each with its minimum retention in whole years, 1 to 50. A
 * category name is a lowercase letter followed by up to 39 lowercase letters or underscores.
 * Registering a category again with the same minimum is a no-op; a malformed name, an out-of-range
 * minimum, a category another modality owns, or the same category with a different minimum throws,
 * before any of `categories` is registered.
 */
export function registerKeptCategories(
  modality: string,
  categories: Readonly<Record<string, { readonly minRetentionYears: number }>>,
): void {
  for (const [category, { minRetentionYears }] of Object.entries(categories)) {
    if (!/^[a-z][a-z_]{0,39}$/.test(category))
      throw new Error(`\`${category}\` is not a category name`);
    if (!Number.isInteger(minRetentionYears) || minRetentionYears < 1 || minRetentionYears > 50) {
      throw new Error(`\`${category}\` needs a minimum retention of 1 to 50 years`);
    }
    const owner = keptCategories.get(category);
    if (owner === undefined) continue;
    if (owner.modality !== modality) {
      throw new Error(
        `the category \`${category}\` is already ${owner.modality}'s; ${modality} cannot register it`,
      );
    }
    if (owner.minRetentionYears !== minRetentionYears) {
      throw new Error(`${modality} registered the category \`${category}\` twice, differently`);
    }
  }
  for (const [category, { minRetentionYears }] of Object.entries(categories)) {
    keptCategories.set(category, { modality, minRetentionYears });
  }
}

const isKeptCategory = (category: string) => keptCategories.has(category);

/**
 * What an archive kept as its own record when it honoured an erasure: the registered categories,
 * how many rows it signed and keeps, and its retention in years, which is at least the minimum of
 * every category named.
 */
export const keptRecordSchema: z.ZodObject<
  { categories: z.ZodArray<z.ZodString>; clinicRows: z.ZodInt; retentionYears: z.ZodInt },
  z.core.$strict
> = z
  .strictObject({
    categories: z
      .array(
        z
          .string()
          .max(40)
          .refine(isKeptCategory, { message: 'a category no loaded modality registered' }),
      )
      .min(1)
      .refine((categories) => categories.length <= keptCategories.size, {
        message: 'more categories than there are',
      }),
    /** How many rows the holder signed for this patient and keeps. */
    clinicRows: z.int().nonnegative(),
    /** The holder's configured retention, in years from the last visit. */
    retentionYears: z.int().positive().max(50),
  })
  .refine(
    (kept) =>
      kept.categories.every(
        (category) =>
          kept.retentionYears >= (keptCategories.get(category)?.minRetentionYears ?? Infinity),
      ),
    { message: 'shorter than a kept category allows', path: ['retentionYears'] },
  );

/** A kept record as parsed. */
export type KeptRecord = z.infer<typeof keptRecordSchema>;

/**
 * A holder's signed answer to an erasure request. An archive states its backup window and an
 * install has none to state; only an archive may carry `blind` or `kept`; and the outcome is
 * `complete` exactly when nothing in scope remains.
 */
export const erasureReceiptPayloadSchema: z.ZodObject<
  {
    peer: z.ZodString;
    requester: z.ZodString;
    requestId: z.ZodString;
    requestHash: z.ZodString;
    holder: z.ZodEnum<z.core.util.ToEnum<ErasureHolder>>;
    outcome: z.ZodEnum<z.core.util.ToEnum<ErasureOutcome>>;
    scope: typeof revocationScopeSchema;
    rowsRemoved: z.ZodInt;
    attachmentsRemoved: z.ZodInt;
    rowsRemaining: z.ZodInt;
    attachmentsRemaining: z.ZodInt;
    completedAt: z.ZodString;
    software: z.ZodString;
    backups: z.ZodOptional<
      z.ZodObject<{ retentionDays: z.ZodInt; lastCopyExpiresAt: z.ZodString }, z.core.$strict>
    >;
    beyondReach: z.ZodLiteral<typeof BEYOND_REACH>;
    blind: z.ZodOptional<z.ZodString>;
    kept: z.ZodOptional<typeof keptRecordSchema>;
    signature: z.ZodString;
  },
  z.core.$strict
> = z
  .strictObject({
    /** The holder that answered, whose key the signature verifies against. */
    peer: peerKeyHex,
    /** The patient the answer is for. Binds the receipt to one requester. */
    requester: peerKeyHex,
    /** The `erasure_request` row this answers. */
    requestId: z.string().min(1).max(64),
    /** And its digest, so a receipt cannot be re-pointed at a different ask (§4). */
    requestHash: digestHex,
    holder: z.enum(ERASURE_HOLDERS),
    outcome: z.enum(ERASURE_OUTCOMES),
    /**
     * The scope as the holder understood it, which need not be the scope as sent. A holder that
     * read it narrowly says so here, and a patient can set the two side by side (§4).
     */
    scope: revocationScopeSchema,
    rowsRemoved: z.int().nonnegative(),
    attachmentsRemoved: z.int().nonnegative(),
    /** What the holder found in scope and could not remove. Zero on a complete answer. */
    rowsRemaining: z.int().nonnegative(),
    attachmentsRemaining: z.int().nonnegative(),
    completedAt: z.string().max(40),
    /** The answering software and its version, as §4 asks. */
    software: z.string().min(1).max(64),
    /**
     * An archive's backup window (§5): the operator's configured retention, and the day the
     * last copy made before this erasure expires. Required of an archive, refused from an install.
     */
    backups: z
      .strictObject({
        retentionDays: z.int().positive().max(3650),
        lastCopyExpiresAt: z.string().max(40),
      })
      .optional(),
    /**
     * What the answering device could not reach, carried in the receipt rather than implied by
     * it. ADR-16 §1: a revocation is an instruction to software the patient does not control, and
     * a receipt that did not say so would be the false promise the whole section exists to avoid.
     */
    beyondReach: z.literal(BEYOND_REACH),
    /**
     * ADR-17 §4a item 3: the random value that blinds this receipt's entry in the witnessed log,
     * `H(receipt ‖ blind)`. Only the patient holds it, so only the patient can find the entry.
     * Reserved in 1.0 and optional until the log exists; archive receipts only, since an install
     * publishes nothing.
     */
    blind: digestHex.optional(),
    /**
     * ADR-20 §9: what an archive kept as its own record, named in the receipt so the patient reads
     * it there and not only in the consent text. Archive receipts only.
     */
    kept: keptRecordSchema.optional(),
    signature: signatureHex,
  })
  .refine((receipt) => (receipt.holder === 'archive') === (receipt.backups !== undefined), {
    message: 'an archive states its backup window, and an install has none to state',
  })
  .refine((receipt) => receipt.blind === undefined || receipt.holder === 'archive', {
    message: 'only an archive logs a receipt, so only an archive blinds one',
  })
  .refine((receipt) => receipt.kept === undefined || receipt.holder === 'archive', {
    message: 'only a clinic archive keeps a record of its own, so only an archive names one',
  })
  .refine(
    (receipt) =>
      (receipt.outcome === 'complete') ===
      (receipt.rowsRemaining === 0 && receipt.attachmentsRemaining === 0),
    { message: 'a complete answer leaves nothing in scope, and a partial one says what it left' },
  );

/** An erasure receipt's payload as parsed. */
export type ErasureReceiptPayload = z.infer<typeof erasureReceiptPayloadSchema>;
