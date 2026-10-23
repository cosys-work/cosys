import {
  bridgeBodySchemas,
  bridgePayloadSchemas,
  bridgeRowMessage,
  bytesToHex,
  ed25519,
  hexToBytes,
  hkdfSha256,
  isBridgeKind,
  utf8,
  type BridgeActor,
  type BridgeBody,
  type BridgeBodyInput,
  type BridgeKind,
  type BridgePayload,
} from './deps.ts';
import { erasureRequestDigest, readErasureRequest } from './erasure.ts';
import type { SyncEntry } from './messages.ts';

/**
 * Writing and checking a `bridge:` row (ADR-22 §3; PLAN M19-2). The shapes and the bytes a
 * signature covers are `@cosys/record`'s `bridge.ts`; this is the half that needs keys, as
 * `assertions.ts` is for an assertion. It is `clinic-rows.ts`'s pattern, generalised (ADR-22
 * §Consequences): a bridge is the second unit that writes signed rows into a patient's record.
 *
 * **Two signatures, one message.** The running instance signs with its own key, derived from the
 * bridge's seed and the instance's label, and the bridge key signs the same bytes, which include
 * the instance's public key. The patient's phone trusts the bridge key it paired with; the
 * instance's signature is the operator's accountability for which copy wrote the row.
 *
 * Nothing here registers the `bridge:` kinds: the phone checks a row's shape and signature with
 * this module whether or not its store holds bridged rows yet (`@cosys/record`'s
 * `bridge-kinds.ts`).
 */

const INSTANCE_SALT = utf8('tapp-bridge/instance-signing/v1');

/** An instance's signing seed: HKDF over the bridge seed, salted by purpose, labelled by instance. */
export function bridgeInstanceSeed(bridgeSeed: Uint8Array, instance: string): Uint8Array {
  return hkdfSha256(bridgeSeed, INSTANCE_SALT, utf8(instance), 32);
}

/** The keys `signBridgeRow` signs with: the bridge's seed and the running instance's label. */
export interface BridgeSigner {
  /** The bridge's Ed25519 seed: the identity its directory entry names. */
  readonly bridgeSeed: Uint8Array;
  /** Which running copy this is (`estate-1`, a clinic node's label). Configuration. */
  readonly instance: string;
}

/** The row columns a bridge chooses for a row it writes; the rest are fixed. */
export interface BridgeRowHeader<K extends BridgeKind> {
  /** The row's id. Covered by both signatures. */
  readonly id: string;
  /** The `bridge:` kind of the row, which picks the body's schema. Covered by both signatures. */
  readonly kind: K;
  /** The device id the row is written under. Covered by both signatures. */
  readonly deviceId: string;
  /** When the recorded thing happened, ISO 8601. Covered by both signatures. */
  readonly occurredAt: string;
  /** When the row was written, ISO 8601. Not covered by the signatures. */
  readonly recordedAt: string;
}

/** The fixed columns every bridged row has: nothing the signature does not cover acts on the record. */
const FIXED = {
  source: 'system',
  supersedesId: null,
  targetId: null,
  glucoseMgdl: null,
  aiModelId: null,
  aiSuggestion: null,
} as const;

/**
 * Writes a signed `bridge:` row for `patient` (that patient's identity key, lowercase hex): the
 * body is parsed against its kind's schema first, then signed by the instance key and the bridge
 * key over the same message. Throws when the body does not parse.
 */
export function signBridgeRow<K extends BridgeKind>(
  header: BridgeRowHeader<K>,
  patient: string,
  input: BridgeBodyInput<K>,
  signer: BridgeSigner,
): SyncEntry {
  // Parsed before it is signed, so the bytes signed are the bytes the phone rebuilds.
  const body = bridgeBodySchemas[header.kind].parse(input) as BridgeBody<K>;
  const instanceSeed = bridgeInstanceSeed(signer.bridgeSeed, signer.instance);
  const bridge = bytesToHex(ed25519.getPublicKey(signer.bridgeSeed));
  const actor = { instance: signer.instance, key: bytesToHex(ed25519.getPublicKey(instanceSeed)) };
  const signed = {
    id: header.id,
    kind: header.kind,
    deviceId: header.deviceId,
    occurredAt: header.occurredAt,
  };
  const message = bridgeRowMessage(signed, { bridge, patient, actor, body });
  const payload = bridgePayloadSchemas[header.kind].parse({
    bridge,
    patient,
    actor: { ...actor, signature: bytesToHex(ed25519.sign(message, instanceSeed)) },
    body,
    signature: bytesToHex(ed25519.sign(message, signer.bridgeSeed)),
  });
  return {
    ...signed,
    recordedAt: header.recordedAt,
    ...FIXED,
    payload: JSON.stringify(payload),
  } as SyncEntry;
}

/**
 * Why `verifyBridgeRow` refused a row: not a `bridge:` kind, a payload or fixed column that does
 * not match, a bridge or kind not paired, a row for another patient, or a signature (the bridge's
 * or the instance's) that does not verify.
 */
export type BridgeRowRefusal =
  | 'not_bridge'
  | 'shape'
  /** Signed by a key this patient did not pair with as a bridge. */
  | 'not_paired'
  /** A kind the bridge's directory entry does not permit it to write (PLAN M19-3). */
  | 'not_permitted'
  | 'other_patient'
  | 'signature';

/**
 * The payload of a `bridge:` row this phone may write, or why not. `paired` maps each bridge key
 * the patient paired with to the kinds its directory entry permits; `patient` is this phone's own
 * identity key. The columns the signature does not cover must be the fixed ones `signBridgeRow`
 * writes, as for a clinic's row (`clinic-rows.ts`, 2026-10-16): a `target_id` would delete one of
 * the patient's own rows.
 */
export function verifyBridgeRow(
  row: Pick<SyncEntry, 'id' | 'kind' | 'deviceId' | 'occurredAt' | 'payload'> &
    Partial<Pick<SyncEntry, keyof typeof FIXED>>,
  paired: ReadonlyMap<string, ReadonlySet<string>>,
  patient: string,
): { readonly payload: BridgePayload } | { readonly refused: BridgeRowRefusal } {
  if (!isBridgeKind(row.kind)) return { refused: 'not_bridge' };
  let json: unknown;
  try {
    json = JSON.parse(row.payload);
  } catch {
    return { refused: 'shape' };
  }
  const parsed = bridgePayloadSchemas[row.kind].safeParse(json);
  if (!parsed.success) return { refused: 'shape' };
  const payload = parsed.data as BridgePayload;
  const permitted = paired.get(payload.bridge);
  if (permitted === undefined) return { refused: 'not_paired' };
  if (!permitted.has(row.kind)) return { refused: 'not_permitted' };
  if (payload.patient !== patient) return { refused: 'other_patient' };
  const message = bridgeRowMessage(
    { id: row.id, kind: row.kind, deviceId: row.deviceId, occurredAt: row.occurredAt },
    payload,
  );
  const verifies = (signature: string, key: string) => {
    try {
      return ed25519.verify(hexToBytes(signature), message, hexToBytes(key));
    } catch {
      return false;
    }
  };
  if (
    !verifies(payload.signature, payload.bridge) ||
    !verifies(payload.actor.signature, payload.actor.key)
  ) {
    return { refused: 'signature' };
  }
  for (const [column, expected] of Object.entries(FIXED)) {
    const value = row[column as keyof typeof FIXED];
    if (value !== undefined && value !== expected) return { refused: 'shape' };
  }
  return { payload };
}

/**
 * A bridge's answer to an erasure request (ADR-17 §4; PLAN M19-5), checked against the request it
 * claims to answer, or null: signed by the bridge the request was addressed to, for the patient
 * who asked, naming the request by its row and its digest. A receipt that fails any of those is
 * not an answer to this request, whatever it says, as for a clinic's (`readErasureReceipt`).
 */
export function readBridgeReceipt(
  receipt: SyncEntry,
  request: SyncEntry,
): BridgePayload<'bridge:receipt'> | null {
  if (receipt.kind !== 'bridge:receipt') return null;
  const asked = readErasureRequest(request);
  if (asked === null) return null;
  const verified = verifyBridgeRow(
    receipt,
    new Map([[asked.peer, new Set(['bridge:receipt'])]]),
    asked.requester,
  );
  if (!('payload' in verified)) return null;
  const payload = verified.payload as BridgePayload<'bridge:receipt'>;
  const answers = payload.body.refs.filter((ref) => ref.role === 'request');
  if (answers.length !== 1 || answers[0]!.to !== request.id) return null;
  return payload.body.requestHash === erasureRequestDigest(request) ? payload : null;
}

export type { BridgeActor };
