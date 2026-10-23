import {
  BRIDGE_KINDS,
  bytesToHex,
  ed25519,
  fromBase64,
  hexToBytes,
  isBridgeKind,
  isProtocol,
  PROTOCOLS,
  sha256,
  toBase64,
  utf8,
  type Assertion,
  type AssertionInput,
  type BridgeKind,
  type Protocol,
} from './deps.ts';

/**
 * A bridge, as the operator lists it (ADR-22 §4, §6; PLAN M19-3). A bridge is paired like a clinic:
 * against an entry the operator's directory key signs, which the patient's phone verifies offline
 * before it shows the bridge, and which names what the bridge may write. Whoever runs it, the
 * operator on its estate or a clinic on its own node (ADR-22 call 4, 2026-10-22), the operator
 * signs the entry, so a clinic's bridge is no more trusted than the clinic, and the entry says
 * which of the two holds what it imports.
 *
 * The entry is read as an assertion too (`bridgeOfAssertion`): the operator says `bridge_of`
 * about the bridge key, as the clinic entry is `licensed_clinic` (ADR-23 §5). It carries no
 * number but its dates and a backup window, and nothing ranks one bridge above another.
 */
export interface BridgeDirectoryEntry {
  /** The entry format; only `1` exists. */
  readonly version: 1;
  /** The bridge's Ed25519 key, lowercase hex: what its rows verify against. */
  readonly bridgeKey: string;
  /** What the patient sees it called, as the operator recorded it. */
  readonly name: string;
  /** Who runs it: the operator's name, or the clinic's registered name. */
  readonly operator: string;
  /** The clinic that runs it, by its key, or `null` when the operator does (ADR-22 call 4). */
  readonly clinicKey: string | null;
  /** The protocols it reads (`@cosys/record`'s list). */
  readonly protocols: readonly Protocol[];
  /** The kinds it may write; a row of any other kind is refused on the phone. */
  readonly kinds: readonly BridgeKind[];
  /** The bridge's tier, by name (1 to 40 characters). */
  readonly tier: { readonly name: string };
  /** How long the bridge's backups keep what it imported, in days (ADR-17 §5). */
  readonly backupWindowDays: number;
  /** When the operator signed the entry, an ISO 8601 timestamp. */
  readonly issuedAt: string;
  /**
   * When the entry stops verifying, an ISO 8601 timestamp after `issuedAt` and at most
   * `BRIDGE_ENTRY_MAX_DAYS` from it.
   */
  readonly expiresAt: string;
}

/** A bridge's directory entry with the operator's signature over it. */
export interface SignedBridgeEntry {
  /** The entry the signature covers. */
  readonly entry: BridgeDirectoryEntry;
  /** The operator's directory key, lowercase hex. Must be one the app ships. */
  readonly signer: string;
  /** Ed25519 over `bridgeEntryBytes(entry)`, lowercase hex. */
  readonly signature: string;
}

/** The longest a bridge entry may be valid, from `issuedAt` to `expiresAt`, in days. */
export const BRIDGE_ENTRY_MAX_DAYS = 400;
const BRIDGE_ENTRY_CONTEXT = 'tapp-bridge-directory/v1';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The bytes the operator signs: every field in a fixed order, as one JSON array after a context
 * line. `packages/peer/server/bridge-directory.mjs` builds the same bytes in Node; the vectors in
 * `bridge-directory-vectors.json` hold both to it.
 */
export function bridgeEntryBytes(entry: BridgeDirectoryEntry): Uint8Array {
  return utf8(
    `${BRIDGE_ENTRY_CONTEXT}\n${JSON.stringify([
      entry.version,
      entry.bridgeKey,
      entry.name,
      entry.operator,
      entry.clinicKey,
      entry.protocols,
      entry.kinds,
      entry.tier.name,
      entry.backupWindowDays,
      entry.issuedAt,
      entry.expiresAt,
    ])}`,
  );
}

/**
 * Why `bridgeEntryProblem` refused an entry: a malformed entry, a signer the app does not trust, a
 * signature that does not verify, an entry not yet issued or already expired (with a day's grace
 * either side), or a validity longer than `BRIDGE_ENTRY_MAX_DAYS`.
 */
export type BridgeEntryProblem =
  'shape' | 'signer' | 'signature' | 'not_yet' | 'expired' | 'too_long';

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;

function entryShapeOk(entry: BridgeDirectoryEntry): boolean {
  const list = <T>(value: unknown, ok: (item: string) => boolean, all: readonly T[]) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= all.length &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === 'string' && ok(item));
  return (
    entry.version === 1 &&
    HEX64.test(entry.bridgeKey) &&
    text(entry.name, 120) &&
    text(entry.operator, 120) &&
    (entry.clinicKey === null || HEX64.test(entry.clinicKey)) &&
    list(entry.protocols, isProtocol, PROTOCOLS) &&
    list(entry.kinds, isBridgeKind, BRIDGE_KINDS) &&
    text(entry.tier?.name, 40) &&
    Number.isInteger(entry.backupWindowDays) &&
    entry.backupWindowDays >= 0 &&
    entry.backupWindowDays <= 365 &&
    !Number.isNaN(Date.parse(entry.issuedAt)) &&
    !Number.isNaN(Date.parse(entry.expiresAt))
  );
}

/** Checks a signed entry against the directory keys the app trusts and the clock, offline. */
export function bridgeEntryProblem(
  signed: SignedBridgeEntry,
  trustedSigners: readonly string[],
  now: number = Date.now(),
): BridgeEntryProblem | null {
  const { entry } = signed;
  if (typeof entry !== 'object' || entry === null || !entryShapeOk(entry)) return 'shape';
  if (!HEX64.test(signed.signer) || !trustedSigners.includes(signed.signer)) return 'signer';
  if (!/^[0-9a-f]{128}$/.test(signed.signature)) return 'signature';
  if (
    !ed25519.verify(
      hexToBytes(signed.signature),
      bridgeEntryBytes(entry),
      hexToBytes(signed.signer),
    )
  ) {
    return 'signature';
  }
  const issued = Date.parse(entry.issuedAt);
  const expires = Date.parse(entry.expiresAt);
  if (expires <= issued || expires - issued > BRIDGE_ENTRY_MAX_DAYS * 86_400_000) return 'too_long';
  // A day's grace either side, for a phone whose clock is a little wrong, as for a clinic's entry.
  if (issued > now + 86_400_000) return 'not_yet';
  if (expires < now - 86_400_000) return 'expired';
  return null;
}

/**
 * What `verifyBridgeRow` takes: each bridge the patient paired with, by key, and the kinds its
 * entry permits. An entry that no longer verifies (expired, a signer the app stopped trusting)
 * drops out, so its bridge's next row is refused as unpaired.
 */
export function pairedBridges(
  entries: readonly SignedBridgeEntry[],
  trustedSigners: readonly string[],
  now: number = Date.now(),
): ReadonlyMap<string, ReadonlySet<string>> {
  const paired = new Map<string, ReadonlySet<string>>();
  for (const signed of entries) {
    if (bridgeEntryProblem(signed, trustedSigners, now) !== null) continue;
    paired.set(signed.entry.bridgeKey, new Set(signed.entry.kinds));
  }
  return paired;
}

/**
 * The entry read as an assertion (ADR-23 §5): the operator's directory key says `bridge_of` about
 * the bridge key, between the entry's dates, naming the clinic that runs it when one does. A
 * reading of the entry the phone holds, not a second copy; `bridgeEntryProblem` decides whether it
 * is believed.
 */
export function bridgeOfAssertion(signed: SignedBridgeEntry): {
  readonly assertion: Assertion;
  readonly signer: string;
} {
  const { entry } = signed;
  return {
    signer: signed.signer,
    assertion: {
      claim: 'bridge_of',
      refs: [
        { role: 'subject', to: entry.bridgeKey, kind: 'key' },
        ...(entry.clinicKey === null
          ? []
          : [{ role: 'operator', to: entry.clinicKey, kind: 'key' as const }]),
      ],
      validFrom: entry.issuedAt,
      validUntil: entry.expiresAt,
    },
  };
}

// ── The patient's half of pairing (ADR-22 §6; PLAN M19-3) ──────────────────────────────────────

const PAIRING_CONTEXT = 'tapp-bridge/pairing-code/v1';

/** A one-time pairing code is 32 hex characters: sixteen random bytes, too many to guess. */
export const PAIRING_CODE = /^[0-9a-f]{32}$/;

/**
 * What a one-time pairing code is kept as, by the bridge and in the patient's assertion: a digest
 * bound to the bridge key, so a code offered to one bridge pairs nothing at another, and the code
 * itself never leaves the patient's phone or the foreign side that printed it.
 */
export function pairingCodeDigest(bridgeKey: string, code: string): string {
  return bytesToHex(sha256(utf8(`${PAIRING_CONTEXT}\n${bridgeKey}\n${code}`)));
}

/**
 * The assertion a patient's phone signs to pair with a bridge as one foreign subject: `paired_with`
 * about the bridge key, the subject as an `origin` (`fhir:Patient/…`, `csv:<lab>/<number>`), and
 * the code's digest as its evidence. The bridge believes it only when that digest was offered for
 * that subject (`@cosys/bridge`'s `pairing.ts`). A lab number alone is printed on paper and
 * guessable, so it is never enough.
 */
export function bridgePairingAssertion(options: {
  readonly bridgeKey: string;
  readonly subject: string;
  readonly code: string;
  readonly validFrom: string;
}): AssertionInput {
  if (!PAIRING_CODE.test(options.code)) throw new Error('a pairing code is 32 hex characters');
  return {
    claim: 'paired_with',
    refs: [
      { role: 'subject', to: options.bridgeKey, kind: 'key' },
      { role: 'origin', to: options.subject, kind: 'origin' },
    ],
    validFrom: options.validFrom,
    evidence: [
      { role: 'subject', to: pairingCodeDigest(options.bridgeKey, options.code), kind: 'blob' },
    ],
  };
}

/**
 * What a lab prints on a report for the patient to scan (PLAN M19-3): the operator-signed entry
 * of the bridge that will carry the results, the patient's subject at that lab, and the one-time
 * code. The phone checks the entry against the directory keys it ships (`bridgeEntryProblem`)
 * before it shows the bridge, as it does a clinic's invite; the code goes to the provisioning
 * service once, to open the intake, and to nobody else.
 */
export const BRIDGE_INVITE_PREFIX = 'tapp://bridge/1/';

/** A bridge invite as decoded from a printed report: see `BRIDGE_INVITE_PREFIX`. */
export interface BridgeInvite {
  /** The operator-signed entry of the bridge, not yet checked. */
  readonly signed: SignedBridgeEntry;
  /** The patient's subject at the lab, as an origin such as `csv:<lab>/<number>`. */
  readonly subject: string;
  /** The one-time pairing code, 32 lowercase hex characters (`PAIRING_CODE`). */
  readonly code: string;
}

/**
 * Encodes an invite as `BRIDGE_INVITE_PREFIX` followed by unpadded base64url JSON. Throws when the
 * code is not a valid pairing code.
 */
export function encodeBridgeInvite(invite: BridgeInvite): string {
  if (!PAIRING_CODE.test(invite.code)) throw new Error('a pairing code is 32 hex characters');
  const json = JSON.stringify({ s: invite.signed, u: invite.subject, c: invite.code });
  return (
    BRIDGE_INVITE_PREFIX +
    toBase64(utf8(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}

/** The invite in a scanned text, or null for anything else. Its entry is not yet believed. */
export function decodeBridgeInvite(input: string): BridgeInvite | null {
  const trimmed = input.replace(/\s+/g, '');
  if (trimmed.slice(0, BRIDGE_INVITE_PREFIX.length).toLowerCase() !== BRIDGE_INVITE_PREFIX)
    return null;
  try {
    const padded = trimmed.slice(BRIDGE_INVITE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      s?: SignedBridgeEntry;
      u?: unknown;
      c?: unknown;
    };
    if (
      typeof parsed.u !== 'string' ||
      typeof parsed.c !== 'string' ||
      !PAIRING_CODE.test(parsed.c)
    )
      return null;
    const signed = parsed.s;
    if (
      typeof signed !== 'object' ||
      signed === null ||
      typeof signed.signer !== 'string' ||
      typeof signed.signature !== 'string' ||
      typeof signed.entry !== 'object' ||
      signed.entry === null
    )
      return null;
    return { signed, subject: parsed.u, code: parsed.c };
  } catch {
    return null;
  }
}
