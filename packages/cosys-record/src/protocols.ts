/**
 * The closed list of protocols a bridged row's `origin` may name, and the functions that build and
 * parse an origin.
 *
 * @module
 */

/**
 * The protocols a bridged row may name as its origin (ADR-22 §2; PLAN M19-2).
 *
 * An `origin` incidence is `<protocol>:<the foreign identifier, verbatim>`. The protocol is a
 * closed vocabulary, like the kinds, because an open string is a second vocabulary that drifts:
 * two bridges spelling one network two ways would defeat the deduplication an origin exists for.
 * The list seats every protocol the 2026-10-20 plan named, with or without a codec, so that a
 * row naming one is checkable before its bridge exists:
 *
 * - `fhir`, `csv`: the first adapter (ADR-22 call 3, 2026-10-22), lab results in.
 * - `nostr`, `activitypub`, `atproto`, `matrix`, `zot`: the faces ADR-22 §5 keeps closed and PLAN
 *   M19-7 puts last. Seated so the vocabulary does not change when one is built.
 *
 * A protocol is added here, in the substrate, because every modality that bridges reads the same
 * origin; a modality cannot register its own.
 */
export const PROTOCOLS = [
  'fhir',
  'csv',
  'nostr',
  'activitypub',
  'atproto',
  'matrix',
  'zot',
] as const;

/** One of `PROTOCOLS`. */
export type Protocol = (typeof PROTOCOLS)[number];

/** Whether `value` is one of `PROTOCOLS`. */
export function isProtocol(value: string): value is Protocol {
  return (PROTOCOLS as readonly string[]).includes(value);
}

/** The longest foreign identifier an origin carries, after its protocol and colon. */
export const ORIGIN_ID_MAX = 480;

/** `<protocol>:<id>`, or `null` when `id` is empty, too long or the protocol is not listed. */
export function originOf(protocol: string, id: string): string | null {
  if (!isProtocol(protocol) || id.length === 0 || id.length > ORIGIN_ID_MAX) return null;
  return `${protocol}:${id}`;
}

/** The protocol and identifier of an origin, or `null` when it is not one. */
export function parseOrigin(
  origin: string,
): { readonly protocol: Protocol; readonly id: string } | null {
  const colon = origin.indexOf(':');
  if (colon < 1) return null;
  const protocol = origin.slice(0, colon);
  const id = origin.slice(colon + 1);
  return originOf(protocol, id) === null ? null : { protocol: protocol as Protocol, id };
}
