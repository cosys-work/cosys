/**
 * The rows a bridge writes (ADR-22 §2, §3; PLAN M19-2): their kinds, their envelope and the bytes
 * a signature covers.
 *
 * A bridge is a peer with two faces: toward a foreign protocol it is whatever that protocol needs,
 * and toward the network it writes rows into one patient's record, signed under its own key, as a
 * clinic does (ADR-20 §4). This module is the shape of those rows and nothing else: it has no
 * keys (`@cosys/peer`'s `bridge-rows.ts` signs and checks), no loop (`@cosys/bridge`), and no
 * protocol (`@tapp/bridge-lab` and whatever follows it).
 *
 * **The kinds are named here and registered elsewhere** (`bridge-kinds.ts`). An app loads this
 * module to check a row; it holds the kinds only when it imports `bridge-kinds.ts`, which is the
 * act of deciding that its store accepts them. TApp's store takes every registered kind that is
 * not a control kind (`MAY_ARRIVE`), so registering them wherever the shape is read would let a
 * bridge's rows in before TApp's landing rule checks them (`docs/cat-pub/progress.md`, Owed).
 *
 * **Every payload is an envelope**, as a clinic's is: the bridge's key, the patient it is for,
 * the instance that wrote it (its own key, derived from the bridge's, and that key's signature),
 * the body, and the bridge key's signature over all of it. The two signatures are ADR-20 §4's:
 * the bridge key is what the patient paired with, and the instance key is the operator's own
 * accountability for which running copy (the estate's, a clinic node's) wrote the row.
 *
 * @module
 */

import { z } from 'zod';

import type { KindSpec } from './kinds.ts';
import { incidenceSchema, type Incidence } from './refs.ts';
import { isoTimestamp, ulidRef } from './schema/common.ts';
import { signedRowMessage, type SignedRowHeader } from './signed.ts';

/**
 * The modality the `bridge:` kinds are registered under, rather than the substrate's
 * (`bridge-kinds.ts`).
 */
export const BRIDGE_MODALITY = 'bridge';

/** The kinds of row a bridge writes into a patient's record. */
export const BRIDGE_KINDS = [
  'bridge:import',
  'bridge:message',
  'bridge:ack',
  'bridge:receipt',
] as const;
/** One of `BRIDGE_KINDS`. */
export type BridgeKind = (typeof BRIDGE_KINDS)[number];

/**
 * Whether `kind` is one of `BRIDGE_KINDS`. A check of the name only: it does not say whether
 * `bridge-kinds.ts` has registered them in this process.
 */
export function isBridgeKind(kind: string): kind is BridgeKind {
  return (BRIDGE_KINDS as readonly string[]).includes(kind);
}

/** The registry answers of a `bridge:` kind that is a record. */
type BridgeRecordSpec = { readonly travels: false; readonly authoredByAnother: true };
/** The registry answers of a `bridge:` kind that is an act about sharing. */
type BridgeControlSpec = {
  readonly travels: false;
  readonly control: true;
  readonly authoredByAnother: true;
};

/**
 * What each kind is, for the registry (ADR-22 §3). **None travels**: a bridged row reaches its
 * one patient by the bridge's own route and is never sent on from the phone under any grant. Each
 * is **authored by another unit**, so no revocation or erasure scope of the patient's reaches it:
 * the bridge keeps its own record and answers an erasure with `bridge:receipt`. The receipt and
 * the acknowledgement are acts about sharing (control kinds), as `erasure_receipt` is.
 */
export const BRIDGE_KIND_SPECS: {
  readonly 'bridge:import': BridgeRecordSpec;
  readonly 'bridge:message': BridgeRecordSpec;
  readonly 'bridge:ack': BridgeControlSpec;
  readonly 'bridge:receipt': BridgeControlSpec;
} = {
  'bridge:import': { travels: false, authoredByAnother: true },
  'bridge:message': { travels: false, authoredByAnother: true },
  'bridge:ack': { travels: false, control: true, authoredByAnother: true },
  'bridge:receipt': { travels: false, control: true, authoredByAnother: true },
} as const satisfies Record<BridgeKind, KindSpec>;

// ── What an import may carry ───────────────────────────────────────────────────────────────────

/**
 * The shapes a `bridge:import` body may take, registered by the modality that knows them: the
 * health modality's lab analyte, later a CGM series. The substrate cannot know what a lab result
 * is, so it asks, as it asks the view registry what a view is. Re-registering a name under the same
 * modality replaces it (a module evaluated twice); another modality's name is an error.
 */
const importShapes = new Map<string, { readonly modality: string; readonly schema: z.ZodType }>();

/**
 * Adds a modality's `bridge:import` body shapes, by name. A name is a lowercase letter followed by
 * up to 39 lowercase letters or underscores. Throws on a malformed name or on a name another
 * modality registered, before registering any of `shapes`; the same modality registering a name
 * again replaces its schema.
 */
export function registerImportShapes(
  modality: string,
  shapes: Readonly<Record<string, z.ZodType>>,
): void {
  for (const name of Object.keys(shapes)) {
    if (!/^[a-z][a-z_]{0,39}$/.test(name))
      throw new Error(`\`${name}\` is not an import shape name`);
    const owner = importShapes.get(name);
    if (owner !== undefined && owner.modality !== modality) {
      throw new Error(
        `the import shape \`${name}\` is already ${owner.modality}'s; ${modality} cannot register it`,
      );
    }
  }
  for (const [name, schema] of Object.entries(shapes)) importShapes.set(name, { modality, schema });
}

/**
 * The schema registered under an import shape name, or `undefined` when no loaded modality
 * registered it.
 */
export function importShape(name: string): z.ZodType | undefined {
  return importShapes.get(name)?.schema;
}

// ── The bodies ─────────────────────────────────────────────────────────────────────────────────

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'a key is 64 lowercase hex characters');
const hex128 = z.string().regex(/^[0-9a-f]{128}$/, 'a signature is 128 lowercase hex characters');

/** The longest foreign object an import keeps inline; a larger one is kept by its digest. */
export const FOREIGN_TEXT_MAX = 16_000;
/**
 * The longest text a `bridge:message` carries, as string length; also the bound on a receipt's
 * `foreignKeeps`.
 */
export const BRIDGE_MESSAGE_MAX = 2_000;

/**
 * The foreign object an import was translated from, kept beside the translation because a
 * translation is a reading of it (ADR-23 §4): verbatim when it is small, by digest when it is not.
 */
export const foreignObjectSchema: z.ZodUnion<
  readonly [
    z.ZodObject<{ mediaType: z.ZodString; text: z.ZodString }, z.core.$strict>,
    z.ZodObject<{ mediaType: z.ZodString; sha256: z.ZodString; bytes: z.ZodInt }, z.core.$strict>,
  ]
> = z.union([
  z.strictObject({
    mediaType: z.string().min(1).max(100),
    text: z.string().min(1).max(FOREIGN_TEXT_MAX),
  }),
  z.strictObject({
    mediaType: z.string().min(1).max(100),
    sha256: hex64,
    bytes: z.int().min(1),
  }),
]);
/** The foreign object an import was translated from: inline text, or a digest and a byte count. */
export type ForeignObject = z.infer<typeof foreignObjectSchema>;

const refs: z.ZodArray<typeof incidenceSchema> = z.array(incidenceSchema).max(16);
const originsIn = (list: readonly Incidence[]) => list.filter((ref) => ref.role === 'origin');

/** Exactly one `origin`, of the origin kind: a row with none is not a bridged row (ADR-22 §2). */
function oneOrigin(list: readonly Incidence[], context: z.RefinementCtx): void {
  const origins = originsIn(list);
  if (origins.length !== 1 || origins[0]!.kind !== 'origin') {
    context.addIssue({
      code: 'custom',
      message: 'a bridged row names exactly one origin',
      path: ['refs'],
    });
  }
}

/**
 * The body schema of each `bridge:` kind. Every body but a receipt's names exactly one `origin`;
 * an import's `body` must parse as the registered shape its `as` names; an acknowledgement names
 * one `subject` row and a receipt one `request` row. At most 16 refs on any of them.
 */
export const bridgeBodySchemas: {
  readonly 'bridge:import': z.ZodObject<
    { refs: typeof refs; as: z.ZodString; body: z.ZodUnknown; foreign: typeof foreignObjectSchema },
    z.core.$strict
  >;
  readonly 'bridge:message': z.ZodObject<{ refs: typeof refs; text: z.ZodString }, z.core.$strict>;
  readonly 'bridge:ack': z.ZodObject<{ refs: typeof refs }, z.core.$strict>;
  readonly 'bridge:receipt': z.ZodObject<
    {
      refs: typeof refs;
      requestHash: z.ZodString;
      purgedAt: z.ZodISODateTime;
      purged: z.ZodArray<z.ZodString>;
      backups: z.ZodObject<{ retentionDays: z.ZodInt }, z.core.$strict>;
      foreignKeeps: z.ZodString;
    },
    z.core.$strict
  >;
} = {
  'bridge:import': z
    .strictObject({
      refs,
      /** The registered import shape `body` has (`registerImportShapes`). */
      as: z.string().regex(/^[a-z][a-z_]{0,39}$/),
      body: z.unknown(),
      foreign: foreignObjectSchema,
    })
    .superRefine((value, context) => {
      oneOrigin(value.refs, context);
      const shape = importShape(value.as);
      if (shape === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'an import shape no loaded modality registered',
          path: ['as'],
        });
      } else if (!shape.safeParse(value.body).success) {
        context.addIssue({
          code: 'custom',
          message: 'the body is not the shape it names',
          path: ['body'],
        });
      }
    }),
  'bridge:message': z
    .strictObject({ refs, text: z.string().trim().min(1).max(BRIDGE_MESSAGE_MAX) })
    .superRefine((value, context) => oneOrigin(value.refs, context)),
  /** That a row left through the outward face and what it became (ADR-22 §5, PLAN M19-6). */
  'bridge:ack': z.strictObject({ refs }).superRefine((value, context) => {
    oneOrigin(value.refs, context);
    if (value.refs.filter((ref) => ref.role === 'subject' && ref.kind === 'entry').length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'an acknowledgement is about one row',
        path: ['refs'],
      });
    }
  }),
  /**
   * The bridge's half of an erasure (ADR-17; ADR-22 §3; PLAN M19-5): the request it answers, by
   * its row and its digest as every receipt names it (ADR-17 §4); the rows it had written for the
   * patient, of which it now keeps no record; its backup window (§5); and, in the operator's own
   * words, what the foreign side keeps and the bridge cannot reach. Said even when it is nothing,
   * so a receipt never implies more than it is.
   */
  'bridge:receipt': z
    .strictObject({
      refs,
      requestHash: hex64,
      purgedAt: isoTimestamp,
      purged: z.array(ulidRef).max(10_000),
      backups: z.strictObject({ retentionDays: z.int().min(0).max(3650) }),
      foreignKeeps: z.string().trim().min(1).max(BRIDGE_MESSAGE_MAX),
    })
    .superRefine((value, context) => {
      if (value.refs.filter((ref) => ref.role === 'request' && ref.kind === 'entry').length !== 1) {
        context.addIssue({
          code: 'custom',
          message: 'a receipt answers one request',
          path: ['refs'],
        });
      }
    }),
} as const satisfies Record<BridgeKind, z.ZodType>;

/** The parsed body of a `bridge:` kind. */
export type BridgeBody<K extends BridgeKind = BridgeKind> = z.infer<(typeof bridgeBodySchemas)[K]>;
/**
 * A `bridge:` body as a writer supplies it, before parsing fills defaults such as an incidence's
 * `kind`.
 */
export type BridgeBodyInput<K extends BridgeKind = BridgeKind> = z.input<
  (typeof bridgeBodySchemas)[K]
>;

// ── The envelope ───────────────────────────────────────────────────────────────────────────────

/** The running copy of the bridge that wrote a row: a label from its configuration, and its key. */
export const bridgeActorSchema: z.ZodObject<
  { instance: z.ZodString; key: z.ZodString; signature: z.ZodString },
  z.core.$strict
> = z.strictObject({
  instance: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,39}$/),
  /** The instance's signing key, derived from the bridge's seed and its label. */
  key: hex64,
  /** That key's signature over the same bytes the bridge key signs. */
  signature: hex128,
});
/** The running copy of the bridge that wrote a row, as parsed. */
export type BridgeActor = z.infer<typeof bridgeActorSchema>;

/** The signed envelope every bridged row's payload is, around the body its kind names. */
type BridgeEnvelope<K extends BridgeKind> = z.ZodObject<
  {
    bridge: z.ZodString;
    patient: z.ZodString;
    actor: typeof bridgeActorSchema;
    body: (typeof bridgeBodySchemas)[K];
    signature: z.ZodString;
  },
  z.core.$strict
>;

function envelope<K extends BridgeKind>(kind: K): BridgeEnvelope<K> {
  return z.strictObject({
    /** The bridge's key: what the patient paired with, and what its directory entry names. */
    bridge: hex64,
    /** The one patient the row is for. Their phone checks it is them. */
    patient: hex64,
    actor: bridgeActorSchema,
    body: bridgeBodySchemas[kind],
    signature: hex128,
  });
}

/** The payload schema of each `bridge:` kind: the signed envelope around that kind's body. */
export const bridgePayloadSchemas: {
  readonly 'bridge:import': BridgeEnvelope<'bridge:import'>;
  readonly 'bridge:message': BridgeEnvelope<'bridge:message'>;
  readonly 'bridge:ack': BridgeEnvelope<'bridge:ack'>;
  readonly 'bridge:receipt': BridgeEnvelope<'bridge:receipt'>;
} = {
  'bridge:import': envelope('bridge:import'),
  'bridge:message': envelope('bridge:message'),
  'bridge:ack': envelope('bridge:ack'),
  'bridge:receipt': envelope('bridge:receipt'),
} as const;

/** The parsed payload of a `bridge:` row: the envelope and its body. */
export type BridgePayload<K extends BridgeKind = BridgeKind> = z.infer<
  (typeof bridgePayloadSchemas)[K]
>;

/** The origin a bridged row names, or `null` for a receipt, which answers a request instead. */
export function originOfRow(payload: BridgePayload): string | null {
  const origin = (payload.body.refs as readonly Incidence[]).find((ref) => ref.role === 'origin');
  return origin?.to ?? null;
}

// ── The bytes a signature covers ───────────────────────────────────────────────────────────────

/**
 * The context line that opens the bytes a bridged row's two signatures cover (`bridgeRowMessage`).
 */
export const BRIDGE_ROW_CONTEXT = 'tapp-bridge/row/v1';

/**
 * What the bridge key and the instance key both sign: the context line, the row header, the
 * patient, the bridge key, the instance without its signature, and the body. ADR-20 §4's shape
 * with `tapp-bridge/row/v1` for `tapp-clinic/row/v1`, so a clinic's signed row can never be
 * replayed as a bridge's or the other way about.
 */
export function bridgeRowMessage(
  header: SignedRowHeader,
  payload: {
    readonly bridge: string;
    readonly patient: string;
    readonly actor: Omit<BridgeActor, 'signature'> & { readonly signature?: string };
    readonly body: unknown;
  },
): Uint8Array {
  const { signature: _instanceSignature, ...actor } = payload.actor;
  return signedRowMessage(BRIDGE_ROW_CONTEXT, header, [
    payload.patient,
    payload.bridge,
    actor,
    payload.body,
  ]);
}
