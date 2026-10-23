/**
 * How a row names the things it joins (ADR-23 §1, §2; PLAN M20-1).
 *
 * A row is a hyperedge node of the record's Levi graph, and its incidences are the typed
 * references it carries, each with a **role**. This module is the substrate's half: what an
 * incidence is, what it may point at, the roles every modality shares, and the registry a
 * modality adds its own roles to. It knows no kind. Which incidences a given kind has is the
 * modality's (`@tapp/record`'s `refsOf`, for the health and clinic rows).
 *
 * **The vocabulary is closed in two layers** (ADR-23 §2 as amended 2026-10-21, founder): the core
 * below, and the roles each modality registers at import time. The union is closed: a role no
 * loaded modality registered is refused, as an unknown kind is.
 *
 * @module
 */

import { z } from 'zod';

import { parseOrigin } from './protocols.ts';
import { isoTimestamp } from './schema/common.ts';

/** What an incidence points at. `origin` is ADR-22 §2's foreign identifier, the one `to` not ours. */
export const REF_KINDS = ['entry', 'key', 'blob', 'origin'] as const;
/** One of `REF_KINDS`. */
export type RefKind = (typeof REF_KINDS)[number];

/**
 * The roles every modality shares. Each is motivated by more than one modality or by none (the
 * handoff's substrate rule):
 *
 * - `supersedes`, `retracts`, `attachment`: what every row may have, from its own columns.
 * - `origin`: a bridged row's foreign identifier (ADR-22 §2).
 * - `subject`, `signer`: what an assertion or a signed act is about, and who signed it (§5).
 * - `peer`, `holder`, `operator`: the units a share, an erasure or a host involves.
 * - `reads`: a reading of a sign, kept beside the sign it reads (§4).
 * - `request`: the erasure request a receipt answers. It moved here from the health modality on
 *   2026-10-22 (founder): the erasure kinds that use it are the substrate's since WP2.
 */
export const CORE_REF_ROLES = [
  'supersedes',
  'retracts',
  'attachment',
  'origin',
  'subject',
  'signer',
  'peer',
  'holder',
  'operator',
  'reads',
  'request',
] as const;
/** One of `CORE_REF_ROLES`. */
export type CoreRefRole = (typeof CORE_REF_ROLES)[number];

/** The modality name the core is registered under. */
export const SUBSTRATE = 'substrate';

const owners = new Map<string, string>(CORE_REF_ROLES.map((role) => [role, SUBSTRATE]));

/**
 * Adds a modality's roles to the vocabulary. Called once, at import time, by the module that
 * defines the modality's incidences. Registering the same roles again under the same name is a
 * no-op, so a module evaluated twice (a test runner, a bundler) is harmless; a role another
 * modality already owns is an error, because two meanings for one label is the drift a closed
 * vocabulary exists to prevent.
 */
export function registerRefRoles(modality: string, roles: readonly string[]): void {
  if (modality === SUBSTRATE) throw new Error('the substrate registers its own roles');
  for (const role of roles) {
    if (!/^[a-z][a-z_]{0,39}$/.test(role)) throw new Error(`\`${role}\` is not a role name`);
    const owner = owners.get(role);
    if (owner !== undefined && owner !== modality) {
      throw new Error(`the role \`${role}\` is already ${owner}'s; ${modality} cannot register it`);
    }
  }
  for (const role of roles) owners.set(role, modality);
}

/** Whether `role` is a core role or one some loaded modality registered. */
export function isRefRole(role: string): boolean {
  return owners.has(role);
}

/** Every registered role and the modality that owns it, sorted by role. */
export function refRoles(): readonly { readonly role: string; readonly modality: string }[] {
  return [...owners]
    .map(([role, modality]) => ({ role, modality }))
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Whether `to` has the shape its kind says. An origin is `<protocol>:<foreign id>`, the protocol
 * one of the registered list (`protocols.ts`, PLAN M19-2, 2026-10-22).
 */
function targetFits(kind: RefKind, to: string): boolean {
  switch (kind) {
    case 'entry':
      return to.length === 26;
    case 'key':
    case 'blob':
      return HEX64.test(to);
    case 'origin':
      return parseOrigin(to) !== null && to.length <= 512;
  }
}

/**
 * One incidence (ADR-23 §2). `kind` defaults to `entry`, the common case; `at` is when the
 * incidence held, for the few that are time-bound.
 *
 * An `entry` target is checked for a ULID's length and not its alphabet, as `ulidRef` is, so
 * that the readable ids the fixtures use are refs like any other.
 */
export const incidenceSchema: z.ZodObject<
  {
    role: z.ZodString;
    to: z.ZodString;
    kind: z.ZodDefault<z.ZodEnum<z.core.util.ToEnum<RefKind>>>;
    at: z.ZodOptional<z.ZodISODateTime>;
  },
  z.core.$strict
> = z
  .strictObject({
    role: z.string().refine(isRefRole, { message: 'a role no loaded modality registered' }),
    to: z.string().min(1).max(512),
    kind: z.enum(REF_KINDS).default('entry'),
    at: isoTimestamp.optional(),
  })
  .refine((ref) => targetFits(ref.kind, ref.to), {
    message: 'the target does not have the shape its kind says',
    path: ['to'],
  });

/** One incidence as parsed, with its `kind` filled in. */
export type Incidence = z.output<typeof incidenceSchema>;

/**
 * An incidence in `role` pointing at the row whose id is `to`. Not validated; `assertRefs` does
 * that.
 */
export function entryRef(role: string, to: string): Incidence {
  return { role, to, kind: 'entry' };
}

/**
 * An incidence in `role` pointing at the key `to`, lowercase hex. Not validated; `assertRefs` does
 * that.
 */
export function keyRef(role: string, to: string): Incidence {
  return { role, to, kind: 'key' };
}

/**
 * An incidence in `role` pointing at the blob whose sha256 is `to`. Not validated; `assertRefs`
 * does that.
 */
export function blobRef(role: string, to: string): Incidence {
  return { role, to, kind: 'blob' };
}

/** What every row carries in its own columns, whatever its kind. */
export interface RowColumns {
  /** Set on an edit: the row it replaces. */
  readonly supersedesId: string | null;
  /** Set on a tombstone: the row it hides. */
  readonly targetId: string | null;
}

/**
 * The incidences every row has from its columns and its attachments, before its kind adds any:
 * `supersedes` from an edit, `retracts` from a tombstone, and one `attachment` per photograph or
 * document, by sha256 (ADR-23 §1's first three rows). Attachments are a table beside the row, so
 * the caller passes their digests.
 */
export function columnRefs(row: RowColumns, attachments: readonly string[] = []): Incidence[] {
  const refs: Incidence[] = [];
  if (row.supersedesId !== null) refs.push(entryRef('supersedes', row.supersedesId));
  if (row.targetId !== null) refs.push(entryRef('retracts', row.targetId));
  for (const sha256 of attachments) refs.push(blobRef('attachment', sha256));
  return refs;
}

/**
 * The one order an incidence list is kept in: by role, then target, then kind, with an exact
 * duplicate dropped. `entry_refs` is keyed by row, role and target, so a list in this order is
 * what makes an index rebuilt from `entries` byte-identical to the one written on insert.
 */
export function normaliseRefs(refs: readonly Incidence[]): Incidence[] {
  const seen = new Set<string>();
  const out: Incidence[] = [];
  for (const ref of refs) {
    const key = `${ref.role}\u0000${ref.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out.sort(
    (a, b) => compare(a.role, b.role) || compare(a.to, b.to) || compare(a.kind, b.kind),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Throws when a list holds an incidence the vocabulary or the target shapes refuse. */
export function assertRefs(refs: readonly Incidence[]): void {
  for (const ref of refs) incidenceSchema.parse(ref);
}
