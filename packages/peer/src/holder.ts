import { z } from 'zod';

import {
  bytesToHex,
  concatBytes,
  ed25519,
  fromBase64,
  hexToBytes,
  hkdfSha256,
  sha256,
  utf8,
} from './deps.ts';

/**
 * A holder's answer to an erasure, from the phone's side (ADR-17 §10; founder, 2026-09-27).
 *
 * The server half is `packages/peer/server/holder/`: it destroys the subject's content key,
 * deletes the rows, and signs one receipt with the holder key. This file is what the phone does
 * with that receipt: parse it, rebuild the signed bytes, and check the signature against the
 * holder key the build pins, and that it answers the request this phone made. Nothing here
 * touches the network.
 *
 * **The formats are the server's, byte for byte.** Every signed text is rebuilt from the parsed
 * JSON with the same domain prefix and fixed-order array as `server/holder/receipt.mjs`;
 * `server/holder/holder.test.ts` signs with Node's crypto and verifies here.
 *
 * **What a verified receipt establishes:** that the holder the operator pinned in this build signed that
 * it removed these rows and destroyed the key they were locked with, at this time, in answer to
 * this request. It is the operator's own statement, which it cannot later deny or alter. It does not show
 * that no copy exists anywhere, and the app's words for it (`contentKeys.*`) say exactly that.
 */

export const HOLDER_RECEIPT_DOMAIN = 'tapp-holder/erasure-receipt/v1';
export const REQUEST_DOMAIN = 'tapp-holder/erasure-request/v1';
export const CAPABILITY_DOMAIN = 'tapp-holder/erasure-capability/v1';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.iso.datetime();
const count = z.number().int().min(0).max(1_000_000_000);
const signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/);

export const holderReceiptSchema: z.ZodObject<
  {
    v: z.ZodLiteral<1>;
    holder: z.ZodObject<
      { role: z.ZodString; key: z.ZodString; software: z.ZodString },
      z.core.$strict
    >;
    request: z.ZodObject<
      { subject: z.ZodString; digest: z.ZodString; receivedAt: z.ZodISODateTime },
      z.core.$strict
    >;
    scope: z.ZodLiteral<'everything'>;
    purged: z.ZodObject<{ archiveRows: z.ZodNumber; mailboxFrames: z.ZodNumber }, z.core.$strict>;
    remaining: z.ZodObject<{ archiveRows: z.ZodNumber }, z.core.$strict>;
    keyDestroyed: z.ZodBoolean;
    outcome: z.ZodEnum<{ complete: 'complete'; partial: 'partial' }>;
    backups: z.ZodObject<
      { retentionDays: z.ZodNumber; lastCopyExpires: z.ZodISODateTime },
      z.core.$strict
    >;
    completedAt: z.ZodISODateTime;
  },
  z.core.$strict
> = z.strictObject({
  v: z.literal(1),
  holder: z.strictObject({
    role: z.string().regex(/^[a-z][a-z-]{0,31}$/),
    key: hex64,
    software: z.string().min(1).max(64),
  }),
  request: z.strictObject({ subject: hex64, digest: hex64, receivedAt: iso }),
  scope: z.literal('everything'),
  purged: z.strictObject({ archiveRows: count, mailboxFrames: count }),
  remaining: z.strictObject({ archiveRows: count }),
  keyDestroyed: z.boolean(),
  outcome: z.enum(['complete', 'partial']),
  backups: z.strictObject({
    retentionDays: z.number().int().min(0).max(365),
    lastCopyExpires: iso,
  }),
  completedAt: iso,
});

/** A holder's receipt with its base64 Ed25519 signature over `receiptSignedText(receipt)`. */
export const signedHolderReceiptSchema: z.ZodObject<
  { receipt: typeof holderReceiptSchema; signature: z.ZodString },
  z.core.$strict
> = z.strictObject({
  receipt: holderReceiptSchema,
  signature,
});

/** A holder's erasure receipt, as `holderReceiptSchema` parses it. */
export type HolderReceipt = z.infer<typeof holderReceiptSchema>;
/** A receipt with its signature, as `signedHolderReceiptSchema` parses it. */
export type SignedHolderReceipt = z.infer<typeof signedHolderReceiptSchema>;

/**
 * The holder keys a build pins, for one role. An empty list verifies nothing.
 *
 * *Security review, 2026-09-27 (finding H):* pinned per role, so a key the operator uses for one holder
 * cannot vouch for a receipt that names another. The pilot archive's role is `pilot-archive`.
 */
export interface HolderPins {
  /** The holder role a receipt must name, such as `pilot-archive`. */
  readonly role: string;
  /** The Ed25519 holder keys trusted for that role, lowercase hex. */
  readonly holderKeys: readonly string[];
}

const text = (value: string) => utf8(value);

/**
 * The erasure capability a phone keeps for one telemetry key (ADR-12 §M5 as amended
 * 2026-09-27). Derived from the key, so consent can send its hash without storing anything new,
 * and kept after revoke, when the key itself is forgotten. It asks for that key's erasure and
 * nothing else.
 */
export function erasureCapability(secretKey: Uint8Array): Uint8Array {
  return hkdfSha256(secretKey, undefined, text(CAPABILITY_DOMAIN), 32);
}

/** What the server stores in place of the capability. */
export function capabilityCommitment(capability: Uint8Array): string {
  return bytesToHex(sha256(concatBytes([text(`${CAPABILITY_DOMAIN}\n`), capability])));
}

/**
 * The digest that names one erasure request, lowercase hex: SHA-256 over the request domain, the
 * subject and the capability commitment. A receipt must carry it to answer that request.
 */
export function requestDigest(subjectHex: string, capabilityCommitHex: string): string {
  return bytesToHex(sha256(text(`${REQUEST_DOMAIN}\n${subjectHex}\n${capabilityCommitHex}`)));
}

/**
 * The text a holder signs for a receipt: the receipt domain line, then every field as one JSON
 * array in a fixed order, as `server/holder/receipt.mjs` builds it.
 */
export function receiptSignedText(r: HolderReceipt): string {
  return `${HOLDER_RECEIPT_DOMAIN}\n${JSON.stringify([
    r.v,
    r.holder.role,
    r.holder.key,
    r.holder.software,
    r.request.subject,
    r.request.digest,
    r.request.receivedAt,
    r.scope,
    r.purged.archiveRows,
    r.purged.mailboxFrames,
    r.remaining.archiveRows,
    r.keyDestroyed,
    r.outcome,
    r.backups.retentionDays,
    r.backups.lastCopyExpires,
    r.completedAt,
  ])}`;
}

/**
 * What `verifyHolderReceipt` found: the receipt, or why it was refused. `inconsistent` is a
 * receipt whose outcome disagrees with its remaining rows, or that completed before it was
 * received.
 */
export type ReceiptCheck =
  | { readonly ok: true; readonly receipt: HolderReceipt }
  | {
      readonly ok: false;
      readonly reason:
        | 'shape'
        | 'wrong-role'
        | 'unknown-holder'
        | 'signature'
        | 'not-this-request'
        | 'inconsistent';
    };

/**
 * Checks a receipt against the pinned holder keys and the request this phone made.
 * `capabilityCommitHex` is recomputed by the caller from the capability it sent, so a receipt
 * for somebody else's request, or re-pointed at this one, fails here.
 */
export function verifyHolderReceipt(
  input: unknown,
  pins: HolderPins,
  subjectHex: string,
  capabilityCommitHex: string,
): ReceiptCheck {
  const parsed = signedHolderReceiptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'shape' };
  const { receipt } = parsed.data;
  if (receipt.holder.role !== pins.role) return { ok: false, reason: 'wrong-role' };
  if (!pins.holderKeys.includes(receipt.holder.key)) return { ok: false, reason: 'unknown-holder' };
  let valid = false;
  try {
    valid = ed25519.verify(
      fromBase64(parsed.data.signature),
      text(receiptSignedText(receipt)),
      hexToBytes(receipt.holder.key),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature' };
  if (
    receipt.request.subject !== subjectHex ||
    receipt.request.digest !== requestDigest(subjectHex, capabilityCommitHex)
  ) {
    return { ok: false, reason: 'not-this-request' };
  }
  if (
    (receipt.outcome === 'complete') !== (receipt.remaining.archiveRows === 0) ||
    Date.parse(receipt.request.receivedAt) > Date.parse(receipt.completedAt)
  ) {
    return { ok: false, reason: 'inconsistent' };
  }
  return { ok: true, receipt };
}
