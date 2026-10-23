/**
 * The closed vocabulary of claims an assertion may make, and a guard for it.
 *
 * @module
 */

/**
 * What an assertion may claim (ADR-23 §5; PLAN M20-1, the starting set confirmed by the founder on
 * 2026-10-21).
 *
 * An assertion is a hyperedge about a hyperedge: a signed row whose `subject` refs name what it is
 * about. The vocabulary is closed and **no claim carries a number, a rank or a score**, and no code
 * computes one from assertions (AGENTS.md C6; ADR-20 §10). Who may make which claim is decided by
 * the key that signs, not by this list; the `assert` kind that carries one is PLAN M20-4.
 *
 * - `licensed_clinic`, `bridge_of`, `revoked`: an operator's directory signer about a clinic, a
 *   bridge, or a listing it withdraws.
 * - `operated_by`: which operator runs a host or a bridge.
 * - `paired_with`: two units that confirmed each other. A clinic asserts it about its own patients
 *   and nothing else (ADR-23 call 3, 2026-10-21).
 * - `same_as`: two keys, one person (ADR-18 §1's account after a restore).
 * - `witnessed`: a holder's log entry (ADR-17 §4a).
 */
export const ASSERT_CLAIMS = [
  'licensed_clinic',
  'operated_by',
  'bridge_of',
  'paired_with',
  'revoked',
  'same_as',
  'witnessed',
] as const;

/** One of `ASSERT_CLAIMS`. */
export type AssertClaim = (typeof ASSERT_CLAIMS)[number];

/** Whether `value` is one of `ASSERT_CLAIMS`. */
export function isAssertClaim(value: string): value is AssertClaim {
  return (ASSERT_CLAIMS as readonly string[]).includes(value);
}
