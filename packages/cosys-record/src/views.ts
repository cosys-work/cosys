/**
 * The views a grant may name, and how each is made (2026-10-22; the Cat Pub handoff's package
 * layout, "projection" in the substrate, the audiences the modality's).
 *
 * A view is what one peer is allowed to be told about a row, applied before anything is sealed
 * (ADR-14 §2): the row itself, a narrower row made from it, or nothing. Which views exist is not
 * the substrate's to decide, any more than which kinds do. A glucose band is the health
 * modality's, so the health modality registers it here with the kinds it reads and writes, and
 * `@cosys/peer`'s grants ask this registry by name. Until 2026-10-22 the projections were code in
 * the peer package and the grant's views an enum it imported from the health package; that import
 * is what this file ends.
 *
 * The substrate registers one view of its own, `full`, which passes every row through: it is
 * motivated by every modality, and it is the only one with no kind to read.
 *
 * @module
 */

import { isKind, SUBSTRATE } from './kinds.ts';
import type { SyncEntry } from './row.ts';

/** A view, made: what a peer is allowed to be told, row by row. */
export interface RowView {
  /** The name a grant uses for this view. */
  readonly name: string;
  /** The row as this peer may see it, or null to send nothing. */
  project(row: SyncEntry): SyncEntry | null;
  /** Whether attachments travel with the rows it passes (a grant can still say no). */
  readonly attachments: boolean;
}

/** Whether `view` sends `row` as it is, rather than a projection of it or nothing. */
export function projectsItself(view: RowView, row: SyncEntry): boolean {
  const shown = view.project(row);
  return shown !== null && shown.kind === row.kind;
}

/** Every row, as it is. */
export const FULL_VIEW: RowView = {
  name: 'full',
  project: (row) => row,
  attachments: true,
};

/**
 * What the app hands a view when it makes one, such as the band a reading is placed against.
 * Empty here: each modality adds the members its views read, by declaration merging
 * (`@tapp/record`'s `views.ts`), so the substrate never names them and an app passing the wrong
 * shape is still a type error.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface ViewContext {}

/** What a modality says about each view it owns. */
export interface ViewSpec {
  /**
   * The kind it reads, or `*` for every kind. Two views on one grant may not read the same kind,
   * because a row would then have two answers to "what does this peer see".
   */
  readonly reads: string;
  /** The kind it writes, or null when it passes rows through as they are. */
  readonly writes: string | null;
  /** Makes the view for one grant. Throws when the context lacks what the view needs. */
  make(context: ViewContext): RowView;
}

/** A view's name, as a grant names it. */
const VIEW_NAME = /^[a-z][a-z_]{0,39}$/;

interface Registered extends ViewSpec {
  readonly modality: string;
}

const registry = new Map<string, Registered>([
  ['full', { modality: SUBSTRATE, reads: '*', writes: null, make: () => FULL_VIEW }],
]);

/**
 * Adds a modality's views. Called once, at import time, by the module that defines them, after
 * the kinds they read and write are registered. The same view registered again by the same
 * modality reading and writing the same kinds is a no-op, as for kinds; a view another modality
 * owns, or one that reads or writes a kind nobody registered, is an error.
 */
export function registerViews(modality: string, views: Readonly<Record<string, ViewSpec>>): void {
  if (modality === SUBSTRATE) throw new Error('the substrate registers its own views');
  for (const [name, spec] of Object.entries(views)) {
    if (!VIEW_NAME.test(name)) throw new Error(`\`${name}\` is not a view name`);
    if (spec.reads !== '*' && !isKind(spec.reads)) {
      throw new Error(`the view \`${name}\` reads \`${spec.reads}\`, which no modality registered`);
    }
    if (spec.writes !== null && !isKind(spec.writes)) {
      throw new Error(
        `the view \`${name}\` writes \`${spec.writes}\`, which no modality registered`,
      );
    }
    const owner = registry.get(name);
    if (owner === undefined) continue;
    if (owner.modality !== modality) {
      throw new Error(
        `the view \`${name}\` is already ${owner.modality}'s; ${modality} cannot register it`,
      );
    }
    if (owner.reads !== spec.reads || owner.writes !== spec.writes) {
      throw new Error(`${modality} registered the view \`${name}\` twice, differently`);
    }
  }
  for (const [name, spec] of Object.entries(views)) {
    registry.set(name, { modality, reads: spec.reads, writes: spec.writes, make: spec.make });
  }
}

/** Whether some loaded modality, or the substrate, registered `view`. */
export function isView(view: string): boolean {
  return registry.has(view);
}

/** The view registered as `view`, or `undefined`. */
export function viewSpec(view: string): ViewSpec | undefined {
  return registry.get(view);
}

/** Whether `kind` is one a registered view writes: a projection, rather than a record. */
export function isViewKind(kind: string): boolean {
  for (const spec of registry.values()) if (spec.writes === kind) return true;
  return false;
}

/**
 * The kinds a row on a receiving device may be scoped by: its own, and the one it was made from.
 *
 * A patient revoking a share says *"stop sharing my glucose readings"*, and on a band peer the
 * rows are `view:glucose_band`. A revocation scoped by kind matched only the literal string until
 * 2026-09-21, so the narrowest views were the ones it silently missed. A view that writes a kind
 * other than the one it reads was made from that one; a view that passes its own kind through
 * (the plan, which is not a row in `entries` at all) was made from nothing a patient could name.
 */
export function scopeKindsOf(kind: string): readonly string[] {
  for (const spec of registry.values()) {
    if (spec.writes === kind && spec.reads !== kind && spec.reads !== '*')
      return [kind, spec.reads];
  }
  return [kind];
}

/** Every registered view with its owner and kinds, sorted by name. */
export function registeredViews(): readonly {
  readonly view: string;
  readonly modality: string;
  readonly reads: string;
  readonly writes: string | null;
}[] {
  return [...registry]
    .map(([view, spec]) => ({
      view,
      modality: spec.modality,
      reads: spec.reads,
      writes: spec.writes,
    }))
    .sort((a, b) => (a.view < b.view ? -1 : a.view > b.view ? 1 : 0));
}
