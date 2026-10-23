import { ed25519, fromBase64, hexToBytes, toBase64, utf8, type GrantPayload } from './deps.ts';

/**
 * The patient's half of a clinic share (ADR-17 §1, ADR-20 §3).
 *
 * A clinic is a peer: it pairs the way a daughter does (ADR-18 §4), is sent rows under a grant
 * the way a daughter is, and is asked to erase the way a daughter is. What differs is the
 * share. A clinic reads values, so a clinic grant is the `full` view and never a band; the
 * patient still names the period, the kinds and whether photographs go.
 *
 * **The other end is the clinic app now** (PLAN M13-C3, 2026-10-02). This file used to hold
 * `createClinicCounterpart`, the reference the clinic was to be built against, with
 * `clinic.test.ts` driving it end to end. The clinic node is `apps/clinic/src/node/clinic-node.ts`,
 * the reference is retired, and the same end-to-end cases run there against SQLite. What stays
 * here is the one thing TApp needs to make a clinic share: the grant.
 *
 * **Reachable from one route.** `scripts/check-peer-fence.mjs` §6 asserts that TApp names
 * `clinicGrant` only in `apps/tapp/src/app/pairing/clinic.tsx`, which verifies the clinic's
 * operator-signed directory entry before it shows a confirmation and asks `shareActsOpen()` like
 * every other share act (ADR-20 §3).
 */

/** What a patient chooses when sharing with a clinic. The view is not a choice (above). */
export interface ClinicShare {
  /** Kinds a grant can scope by (`isGrantScopeKind`); the patient's own, for the health modality. */
  readonly kinds?: readonly string[];
  /** The start of the shared period, ISO 8601; absent leaves the start open. */
  readonly from?: string;
  /** The end of the shared period, ISO 8601; absent leaves the end open. */
  readonly to?: string;
  /** Whether attachment bytes (photographs, reports) travel with their rows. */
  readonly attachments: boolean;
}

/**
 * The version of the consent text a patient reads before pairing with a clinic (ADR-20 §3, §9;
 * PLAN M13-D2). TApp shows the text; both sides record this, so the clinic's pairing record says
 * which words the patient agreed to, and a change to the words is a new version.
 */
// 2026-10-07 (ADR-20 §9, §15; PLAN M18-13): version 2 adds that the clinic may note the patient's
// year of birth and sex for its register, and that pages it prints or saves are its own copies.
export const CLINIC_CONSENT_VERSION = 'clinic-consent/2';

/** The grant a clinic share resolves to, stored like any other grant (ADR-16 §3). */
export function clinicGrant(clinicKey: string, share: ClinicShare): GrantPayload {
  return {
    peer: clinicKey,
    view: 'full',
    ...(share.kinds === undefined ? {} : { kinds: [...share.kinds] }),
    ...(share.from === undefined ? {} : { from: share.from }),
    ...(share.to === undefined ? {} : { to: share.to }),
    attachments: share.attachments,
  };
}

// ── The clinic directory (ADR-20 §3, §11; PLAN M13-D1) ───────────────────────────────────────

/**
 * A clinic, as the operator lists it. A person is identified by the code two people read aloud; a
 * clinic is identified by a list, because without one anyone with a laptop could present
 * themselves as a clinic (ADR-20 §3). So the operator signs an entry for each clinic and the app ships
 * the operator's public key: a patient's phone verifies the signature and the dates, offline, before it
 * shows a clinic to pair with, and shows the name and registration from the entry rather than
 * anything the desk typed.
 *
 * The entry also carries what only the operator may set (ADR-20 §11): the tier and its active-patient
 * limit, so a clinic cannot grant itself one, and the archive's backup window, which the
 * consent screen states. A tier change is a new signed entry, not a build.
 */
export interface ClinicDirectoryEntry {
  /** The entry format; only `1` exists. */
  readonly version: 1;
  /** The clinic's Ed25519 key, lowercase hex: what its signed rows verify against. */
  readonly clinicKey: string;
  /** The clinic's name as it is registered. */
  readonly name: string;
  /** The registration a patient can check: the DoHS facility registration, as the operator recorded it. */
  readonly registration: string;
  /** The tier, and its active-patient limit; `null` is no limit. */
  readonly tier: { readonly name: string; readonly activeLimit: number | null };
  /** The clinic archive's backup window, in days (ADR-17 §5). */
  readonly backupWindowDays: number;
  /** ISO 8601. The entry is not believed before this or after `expiresAt`. */
  readonly issuedAt: string;
  /**
   * ISO 8601. When the entry stops being believed: after `issuedAt`, and at most
   * `CLINIC_ENTRY_MAX_DAYS` from it.
   */
  readonly expiresAt: string;
}

/** A clinic's directory entry with the operator's signature over it. */
export interface SignedClinicEntry {
  /** The entry the signature covers. */
  readonly entry: ClinicDirectoryEntry;
  /** The operator's directory key, lowercase hex. Must be one the app ships. */
  readonly signer: string;
  /** Ed25519 over `clinicEntryBytes(entry)`, lowercase hex. */
  readonly signature: string;
}

/** How long an entry may be valid, at most; a longer one is refused whoever signed it. */
export const CLINIC_ENTRY_MAX_DAYS = 400;
const CLINIC_ENTRY_CONTEXT = 'tapp-clinic-directory/v1';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The bytes the operator signs: every field, in a fixed order, as one JSON array after a context line.
 * `packages/peer/server/clinic-directory-cli.mjs` builds the same bytes in Node; the vectors in
 * `clinic-directory-vectors.json` hold both to it.
 */
export function clinicEntryBytes(entry: ClinicDirectoryEntry): Uint8Array {
  return utf8(
    `${CLINIC_ENTRY_CONTEXT}\n${JSON.stringify([
      entry.version,
      entry.clinicKey,
      entry.name,
      entry.registration,
      entry.tier.name,
      entry.tier.activeLimit,
      entry.backupWindowDays,
      entry.issuedAt,
      entry.expiresAt,
    ])}`,
  );
}

/** Why a signed entry is not believed, or `null` when it is. */
export type ClinicEntryProblem =
  'shape' | 'signer' | 'signature' | 'not_yet' | 'expired' | 'too_long';

function entryShapeOk(entry: ClinicDirectoryEntry): boolean {
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() !== '' && value.length <= max;
  return (
    entry.version === 1 &&
    HEX64.test(entry.clinicKey) &&
    text(entry.name, 120) &&
    text(entry.registration, 60) &&
    text(entry.tier?.name, 40) &&
    (entry.tier.activeLimit === null ||
      (Number.isInteger(entry.tier.activeLimit) && entry.tier.activeLimit >= 0)) &&
    Number.isInteger(entry.backupWindowDays) &&
    entry.backupWindowDays >= 0 &&
    entry.backupWindowDays <= 365 &&
    !Number.isNaN(Date.parse(entry.issuedAt)) &&
    !Number.isNaN(Date.parse(entry.expiresAt))
  );
}

/**
 * Checks a signed entry against the directory keys the app trusts and the clock, offline. The
 * pairing route shows nothing about a clinic until this says `null`.
 */
export function clinicEntryProblem(
  signed: SignedClinicEntry,
  trustedSigners: readonly string[],
  now: number = Date.now(),
): ClinicEntryProblem | null {
  const { entry } = signed;
  if (typeof entry !== 'object' || entry === null || !entryShapeOk(entry)) return 'shape';
  if (!HEX64.test(signed.signer) || !trustedSigners.includes(signed.signer)) return 'signer';
  if (!/^[0-9a-f]{128}$/.test(signed.signature)) return 'signature';
  if (
    !ed25519.verify(
      hexToBytes(signed.signature),
      clinicEntryBytes(entry),
      hexToBytes(signed.signer),
    )
  ) {
    return 'signature';
  }
  const issued = Date.parse(entry.issuedAt);
  const expires = Date.parse(entry.expiresAt);
  if (expires - issued > CLINIC_ENTRY_MAX_DAYS * 86_400_000 || expires <= issued) return 'too_long';
  // A day's grace either side, for a phone whose clock is a little wrong.
  if (issued > now + 86_400_000) return 'not_yet';
  if (expires < now - 86_400_000) return 'expired';
  return null;
}

/**
 * The string the clinic's desk shows as a QR and a long code (PLAN M13-D3): the signed entry,
 * so a phone can verify the clinic with no network. The entry's key is the clinic's identity,
 * the one every device of the clinic holds (ADR-20 §3). One line, URL-shaped, like a person's
 * invite.
 */
export const CLINIC_INVITE_PREFIX = 'tapp://clinic/1/';

/** A clinic invite as decoded from the desk's QR or long code: see `CLINIC_INVITE_PREFIX`. */
export interface ClinicInvite {
  /** The clinic's operator-signed entry, not yet checked. */
  readonly signed: SignedClinicEntry;
}

/**
 * Encodes an invite as `CLINIC_INVITE_PREFIX` followed by unpadded base64url JSON: the signer, the
 * signature and the entry's fields as one array in a fixed order.
 */
export function encodeClinicInvite(invite: ClinicInvite): string {
  const json = JSON.stringify([
    invite.signed.signer,
    invite.signed.signature,
    invite.signed.entry.version,
    invite.signed.entry.clinicKey,
    invite.signed.entry.name,
    invite.signed.entry.registration,
    invite.signed.entry.tier.name,
    invite.signed.entry.tier.activeLimit,
    invite.signed.entry.backupWindowDays,
    invite.signed.entry.issuedAt,
    invite.signed.entry.expiresAt,
  ]);
  return (
    CLINIC_INVITE_PREFIX +
    toBase64(utf8(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}

/**
 * The invite in a scanned or typed text, or null for anything else. Whitespace is ignored and the
 * prefix is matched without regard to case. Its entry is not yet believed: `clinicEntryProblem`
 * decides that.
 */
export function decodeClinicInvite(input: string): ClinicInvite | null {
  const trimmed = input.replace(/\s+/g, '');
  // The prefix without regard to case, as `decodePairingInvite` reads its own: a keyboard or a
  // messaging app that capitalises the first letter turns `tapp://` into `Tapp://`, and the
  // person did nothing wrong (sitting 4, 2026-10-07: refused as unreadable). The payload after
  // it is base64url and stays exactly as typed.
  if (trimmed.slice(0, CLINIC_INVITE_PREFIX.length).toLowerCase() !== CLINIC_INVITE_PREFIX)
    return null;
  try {
    const padded = trimmed.slice(CLINIC_INVITE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const fields = JSON.parse(new TextDecoder().decode(bytes)) as unknown[];
    if (!Array.isArray(fields) || fields.length !== 11) return null;
    const [
      signer,
      signature,
      version,
      clinicKey,
      name,
      registration,
      tierName,
      activeLimit,
      backupWindowDays,
      issuedAt,
      expiresAt,
    ] = fields;
    return {
      signed: {
        signer: String(signer),
        signature: String(signature),
        entry: {
          version: version as 1,
          clinicKey: String(clinicKey),
          name: String(name),
          registration: String(registration),
          tier: {
            name: String(tierName),
            activeLimit: activeLimit === null ? null : Number(activeLimit),
          },
          backupWindowDays: Number(backupWindowDays),
          issuedAt: String(issuedAt),
          expiresAt: String(expiresAt),
        },
      },
    };
  } catch {
    return null;
  }
}
