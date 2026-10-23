import {
  assertPayloadSchema,
  assertRowMessage,
  bytesToHex,
  ed25519,
  hexToBytes,
  type Assertion,
  type AssertionInput,
  type AssertPayload,
} from './deps.ts';
import type { SignedClinicEntry } from './clinic.ts';
import type { SyncEntry } from './messages.ts';

/**
 * Signing an assertion and checking one on arrival (ADR-23 §5; PLAN M20-4).
 *
 * An assertion is a signed claim about units or rows, with no number in it. The shape and the bytes
 * are `@cosys/record`'s; this is the half that needs keys, as `clinic-rows.ts` is for a clinic's
 * rows. **Nothing in the app writes or sends one yet**: `TRAVELS` keeps the kind off every grant,
 * and the route a `paired_with` needs (to the two parties it names, and nobody else) is owed
 * (`docs/cat-pub/progress.md`). What is here is what that route will be checked by.
 */

/** Signs `assertion` with `seed` as the row `header` describes. */
export function signAssertion(
  header: {
    readonly id: string;
    readonly deviceId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
  },
  assertion: AssertionInput,
  seed: Uint8Array,
): SyncEntry {
  const signer = bytesToHex(ed25519.getPublicKey(seed));
  const row = {
    id: header.id,
    kind: 'assert',
    deviceId: header.deviceId,
    occurredAt: header.occurredAt,
  };
  // Parsed before it is signed, so the bytes signed are the bytes a receiver rebuilds.
  const parsed = assertPayloadSchema.shape.assertion.parse(assertion);
  const payload = assertPayloadSchema.parse({
    assertion: parsed,
    signer,
    signature: bytesToHex(ed25519.sign(assertRowMessage(row, { assertion: parsed, signer }), seed)),
  });
  return {
    ...row,
    kind: 'assert',
    recordedAt: header.recordedAt,
    source: 'system',
    supersedesId: null,
    targetId: null,
    payload: JSON.stringify(payload),
    glucoseMgdl: null,
    aiModelId: null,
    aiSuggestion: null,
  } as SyncEntry;
}

/**
 * Why `verifyAssertion` refused a row: not an `assert` row, a payload that does not parse, a
 * signature that does not verify against the signer it names, a claim whose `validFrom` is more
 * than a day ahead of the clock or whose `validUntil` has passed, or a clinic saying more than a
 * clinic may.
 */
export type AssertionRefusal =
  | 'not_assert'
  | 'shape'
  | 'signature'
  | 'not_yet'
  | 'expired'
  /** A clinic claimed something other than `paired_with` (ADR-23 call 3, 2026-10-21). */
  | 'clinic_claim'
  /** A clinic's `paired_with` about someone other than the patient receiving it (register item 21). */
  | 'other_patient';

/** What `verifyAssertion` checks an arriving row against: who is receiving it, and when. */
export interface AssertionContext {
  /** The receiving account's own key. */
  readonly receiver: string;
  /** The clinics this account paired with: an assertion signed by one of them is held to call 3. */
  readonly clinics: readonly string[];
  /** The clock, in epoch milliseconds, the claim's window is checked against. Defaults to `Date.now()`. */
  readonly now?: number;
}

/**
 * Whether an arriving `assert` row may be kept, and its payload when it may.
 *
 * The signature is checked against the signer the row names, the claim against its window, and a
 * clinic's claim against what a clinic may say: `paired_with`, about the receiving patient, and
 * nothing else (ADR-23 §5 and its call 3; the decision register's item 21). A claim from any other
 * signer is returned verified and no more: which keys a receiver believes about what is the
 * receiver's decision, made where the claim is used.
 */
export function verifyAssertion(
  row: Pick<SyncEntry, 'id' | 'kind' | 'deviceId' | 'occurredAt' | 'payload'>,
  context: AssertionContext,
): { readonly payload: AssertPayload } | { readonly refused: AssertionRefusal } {
  if (row.kind !== 'assert') return { refused: 'not_assert' };
  let json: unknown;
  try {
    json = JSON.parse(row.payload);
  } catch {
    return { refused: 'shape' };
  }
  const parsed = assertPayloadSchema.safeParse(json);
  if (!parsed.success) return { refused: 'shape' };
  const payload = parsed.data;
  const message = assertRowMessage(
    { id: row.id, kind: row.kind, deviceId: row.deviceId, occurredAt: row.occurredAt },
    payload,
  );
  if (!ed25519.verify(hexToBytes(payload.signature), message, hexToBytes(payload.signer))) {
    return { refused: 'signature' };
  }
  const now = context.now ?? Date.now();
  const { assertion } = payload;
  if (Date.parse(assertion.validFrom) > now + 86_400_000) return { refused: 'not_yet' };
  if (assertion.validUntil !== undefined && Date.parse(assertion.validUntil) < now)
    return { refused: 'expired' };
  if (context.clinics.includes(payload.signer)) {
    if (assertion.claim !== 'paired_with') return { refused: 'clinic_claim' };
    const subjects = assertion.refs.filter((ref) => ref.role === 'subject');
    if (!subjects.every((ref) => ref.kind === 'key' && ref.to === context.receiver))
      return { refused: 'other_patient' };
  }
  return { payload };
}

/**
 * The directory's signed clinic entry read as the first assertion (ADR-23 §5): an operator's
 * directory key says `licensed_clinic` about a clinic key, valid between the entry's dates. It is a
 * reading of the entry the phone already holds, not a second copy of it: its signature covers the
 * directory's bytes, and `clinicEntryProblem` is still what decides whether it is believed.
 */
export function licensedClinicAssertion(signed: SignedClinicEntry): {
  readonly assertion: Assertion;
  readonly signer: string;
} {
  return {
    signer: signed.signer,
    assertion: {
      claim: 'licensed_clinic',
      refs: [{ role: 'subject', to: signed.entry.clinicKey, kind: 'key' }],
      validFrom: signed.entry.issuedAt,
      validUntil: signed.entry.expiresAt,
    },
  };
}
