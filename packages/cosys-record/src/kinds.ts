/**
 * Which kinds exist, whose they are, and whether a grant may carry them (the handoff's WP2;
 * `docs/handoff/2026-10-21-cat-pub-substrate.md` §What the substrate must not decide).
 *
 * The substrate does not decide the kinds. Each modality registers its own at import time, with
 * two facts about each: whether it **travels** under an ordinary grant, and whether it is a
 * **control** kind (an act about sharing, never in scope of a revocation or an erasure, never in
 * a timeline). The substrate registers its own control kinds the same way, under `SUBSTRATE`.
 *
 * **`TRAVELS` lives here, beside the kinds, and not in `@cosys/peer`.** It used to be a table in
 * `grants.ts` keyed by every kind. As a registry it has to be filled by the modality that owns
 * each kind, and a modality cannot import `@cosys/peer` to do it: the peer package reads the
 * modalities' shapes, so the import would be a cycle. A kind and whether it travels are one
 * registration, so they are one call.
 *
 * **The default is no.** A kind no loaded modality registered is not a kind (`isKind` is false,
 * and the wire schema refuses it), and it does not travel. The discipline the old table had, that
 * a kind added to an app is a type error until somebody says whether it travels, moves to the
 * modality: each registers from a total map over its own kinds (`@tapp/record`'s `kinds.ts`).
 *
 * @module
 */

import { SUBSTRATE } from './refs.ts';

export { SUBSTRATE };

/** What a modality says about each kind it owns. */
export interface KindSpec {
  /** May an ordinary grant carry it? A kind with a route of its own (a reply, a farewell) says no. */
  readonly travels: boolean;
  /** An act about sharing rather than a record: out of every scope, out of `current_entries`. */
  readonly control?: boolean;
  /**
   * Written and signed by another unit, though it sits in the patient's log: a clinic's
   * `clinic:` rows today (ADR-20 §4), a bridge's rows when there are any (ADR-22). No revocation
   * or erasure the patient sends reaches it, whatever device ids its scope names, because the
   * other unit keeps its own signed record (ADR-20 §9, C3). Added 2026-10-22, when the rule moved
   * here from a test of the clinic's prefix in `@cosys/peer`'s `revocation.ts`.
   */
  readonly authoredByAnother?: boolean;
}

/** The registry answers of a control kind: an act about sharing, which never travels. */
type ControlKindSpec = { readonly travels: false; readonly control: true };

/**
 * The substrate's kinds, each motivated by every modality or by none (the handoff's substrate
 * rule). The answers moved here from `TRAVELS` in `@cosys/peer`'s `grants.ts` with their reasons:
 *
 * - **`tombstone` travels.** A retraction is news about a row a peer may hold; the grant scopes it
 *   by the row it retracts, not by its own kind (`grants.ts`, `scopeSubjectOf`).
 * - **`grant` never travels.** A peer has no use for the terms of its own access and every reason
 *   not to see the terms of anyone else's: ADR-16 §2 built a database per relationship so that
 *   family structure would not be disclosable, and a list of grants is family structure written out.
 * - **`revoke` travels only as a farewell**, through `viewForState`, which sends the one revocation
 *   that ends this peer's access and nothing else. No here is what stops a grant sending every
 *   other revocation the patient ever made, which would tell a son the month his sister was cut off.
 * - **The two erasure kinds do not travel.** ADR-17's flow is between the patient and a holder,
 *   by a route of its own with its own decision, not this one by inheritance.
 * - **`assert` does not travel** (ADR-23 §5, 2026-10-21, PLAN M20-4). An assertion goes only
 *   between the two parties it names (`paired_with`), which a grant cannot express. It needs a
 *   route of its own, as the clinic's replies have, and until there is one none leaves the phone.
 */
export const SUBSTRATE_KINDS: {
  readonly tombstone: { readonly travels: true };
  readonly grant: ControlKindSpec;
  readonly revoke: ControlKindSpec;
  readonly erasure_request: ControlKindSpec;
  readonly erasure_receipt: ControlKindSpec;
  readonly assert: ControlKindSpec;
} = {
  tombstone: { travels: true },
  grant: { travels: false, control: true },
  revoke: { travels: false, control: true },
  erasure_request: { travels: false, control: true },
  erasure_receipt: { travels: false, control: true },
  assert: { travels: false, control: true },
} as const satisfies Readonly<Record<string, KindSpec>>;

/** The name of one of the substrate's own kinds. */
export type SubstrateKind = keyof typeof SUBSTRATE_KINDS;

/** A kind's name: a word, or a class prefix and a word (`view:plan`, `clinic:ack`, `bridge:receipt`). */
const KIND_NAME = /^[a-z][a-z_]{0,39}(?::[a-z][a-z_]{0,39})?$/;

interface Registered extends KindSpec {
  readonly modality: string;
}

const registry = new Map<string, Registered>(
  Object.entries(SUBSTRATE_KINDS).map(([kind, spec]) => [kind, { modality: SUBSTRATE, ...spec }]),
);

const same = (a: KindSpec, b: KindSpec) =>
  a.travels === b.travels &&
  (a.control ?? false) === (b.control ?? false) &&
  (a.authoredByAnother ?? false) === (b.authoredByAnother ?? false);

/**
 * Adds a modality's kinds. Called once, at import time, by the module that defines them.
 * Registering the same kinds again with the same answers under the same name is a no-op, so a
 * module evaluated twice (a test runner, a bundler) is harmless. A kind another modality owns is
 * an error, and so is the same modality changing its answer: whether a kind travels is decided
 * once, in source, never by whichever module happened to load last.
 */
export function registerKinds(modality: string, kinds: Readonly<Record<string, KindSpec>>): void {
  if (modality === SUBSTRATE) throw new Error('the substrate registers its own kinds');
  for (const [kind, spec] of Object.entries(kinds)) {
    if (!KIND_NAME.test(kind)) throw new Error(`\`${kind}\` is not a kind name`);
    const owner = registry.get(kind);
    if (owner === undefined) continue;
    if (owner.modality !== modality) {
      throw new Error(
        `the kind \`${kind}\` is already ${owner.modality}'s; ${modality} cannot register it`,
      );
    }
    if (!same(owner, spec))
      throw new Error(`${modality} registered \`${kind}\` twice, differently`);
  }
  for (const [kind, spec] of Object.entries(kinds)) {
    registry.set(kind, {
      modality,
      travels: spec.travels,
      control: spec.control ?? false,
      authoredByAnother: spec.authoredByAnother ?? false,
    });
  }
}

/** Whether some loaded modality, or the substrate, registered `kind`. */
export function isKind(kind: string): boolean {
  return registry.has(kind);
}

/** Whether an ordinary grant may carry `kind`. No for a kind nobody registered. */
export function travelsUnderGrant(kind: string): boolean {
  return registry.get(kind)?.travels ?? false;
}

/** Whether `kind` is an act about sharing. No for a kind nobody registered. */
export function isControlKind(kind: string): boolean {
  return registry.get(kind)?.control ?? false;
}

/** Whether another unit wrote and signed `kind`, so no scope of the patient's reaches it. */
export function isAuthoredByAnother(kind: string): boolean {
  return registry.get(kind)?.authoredByAnother ?? false;
}

/** The modality that registered `kind`, or `undefined`. */
export function modalityOf(kind: string): string | undefined {
  return registry.get(kind)?.modality;
}

/** Every registered kind with its owner and answers, sorted by kind. */
export function registeredKinds(): readonly {
  readonly kind: string;
  readonly modality: string;
  readonly travels: boolean;
  readonly control: boolean;
  readonly authoredByAnother: boolean;
}[] {
  return [...registry]
    .map(([kind, spec]) => ({
      kind,
      modality: spec.modality,
      travels: spec.travels,
      control: spec.control ?? false,
      authoredByAnother: spec.authoredByAnother ?? false,
    }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
