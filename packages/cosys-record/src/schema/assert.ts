/**
 * An assertion: a signed claim about units or rows, with no number in it (ADR-23 §5; PLAN M20-4).
 *
 * The row is a control kind, `assert`. Its payload is the claim, the key that signed it and the
 * signature, over the bytes `assertRowMessage` builds. **There is no numeric field anywhere in the
 * shape**: the claim is a name, what it is about is `refs`, and its validity is two timestamps, so
 * a score, a rank or a weight cannot be written into one (AGENTS.md C6; ADR-20 §10). Who may make
 * which claim is the signer's, and is checked by whoever receives it (`@cosys/peer`
 * `assertionProblem`).
 *
 * @module
 */

import { z } from 'zod';

import { ASSERT_CLAIMS, type AssertClaim } from '../claims.ts';
import { incidenceSchema } from '../refs.ts';
import { signedRowMessage, type SignedRowHeader } from '../signed.ts';
import { isoTimestamp } from './common.ts';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const hex128 = z.string().regex(/^[0-9a-f]{128}$/);

/** The context line that opens the bytes an assertion's signature covers (`assertRowMessage`). */
export const ASSERT_CONTEXT = 'tapp-assert/row/v1';

/**
 * A claim, what it is about, and when it holds. `refs` names at least one `subject`, and
 * `validUntil`, when given, is later than `validFrom`.
 */
export const assertionSchema: z.ZodObject<
  {
    claim: z.ZodEnum<z.core.util.ToEnum<AssertClaim>>;
    refs: z.ZodArray<typeof incidenceSchema>;
    validFrom: z.ZodISODateTime;
    validUntil: z.ZodOptional<z.ZodISODateTime>;
    evidence: z.ZodOptional<z.ZodArray<typeof incidenceSchema>>;
  },
  z.core.$strict
> = z
  .strictObject({
    claim: z.enum(ASSERT_CLAIMS),
    /** What the claim is about; at least one `subject`. */
    refs: z.array(incidenceSchema).min(1).max(16),
    validFrom: isoTimestamp,
    validUntil: isoTimestamp.optional(),
    /** Rows or blobs the claim rests on, such as a witnessed log entry (ADR-17 §4a). */
    evidence: z.array(incidenceSchema).max(8).optional(),
  })
  .refine((assertion) => assertion.refs.some((ref) => ref.role === 'subject'), {
    message: 'an assertion is about at least one subject',
    path: ['refs'],
  })
  .refine(
    (assertion) =>
      assertion.validUntil === undefined ||
      Date.parse(assertion.validUntil) > Date.parse(assertion.validFrom),
    {
      message: 'an assertion stops being valid after it starts',
      path: ['validUntil'],
    },
  );

/** An assertion as parsed. */
export type Assertion = z.output<typeof assertionSchema>;
/**
 * An assertion as a writer supplies it, before parsing fills defaults such as an incidence's
 * `kind`.
 */
export type AssertionInput = z.input<typeof assertionSchema>;

/** An `assert` row's payload: the assertion, the key that signed it, and the signature. */
export const assertPayloadSchema: z.ZodObject<
  { assertion: typeof assertionSchema; signer: z.ZodString; signature: z.ZodString },
  z.core.$strict
> = z.strictObject({
  assertion: assertionSchema,
  /** The key that signed it, lowercase hex. */
  signer: hex64,
  /** Ed25519 by `signer` over `assertRowMessage`, lowercase hex. */
  signature: hex128,
});

/** An `assert` row's payload as parsed. */
export type AssertPayload = z.output<typeof assertPayloadSchema>;

/** What an assertion's signer signs: the context, the row header, the signer and the claim. */
export function assertRowMessage(
  header: SignedRowHeader,
  payload: { readonly assertion: AssertionInput; readonly signer: string },
): Uint8Array {
  return signedRowMessage(ASSERT_CONTEXT, header, [payload.signer, payload.assertion]);
}
