/**
 * The bytes a signed row's signature covers (ADR-20 §4, generalised for ADR-23 §5; PLAN M20-4).
 *
 * Two kinds of row are signed by a key other than the author's install today: a clinic's `clinic:`
 * rows and an assertion. Both sign a context line and a canonical JSON array of the row header and
 * the body, so that a signed statement cannot be moved to another row and the bytes can be rebuilt
 * from the parsed payload rather than read off the wire. That shape is the substrate's; the
 * context line and the parts are each kind's.
 *
 * @module
 */

/**
 * A value as canonical JSON: object keys sorted, `undefined` members dropped, nothing else
 * changed. A row is parsed and re-written on its way to a phone, so sorted keys are what make the
 * rebuild exact whatever order a writer used.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

/** The row fields a signature binds. */
export interface SignedRowHeader {
  /** The row's id. */
  readonly id: string;
  /** The row's kind. */
  readonly kind: string;
  /** The device id the row was written under. */
  readonly deviceId: string;
  /** When the row says it happened, as written in the row. */
  readonly occurredAt: string;
}

/** `context`, a newline, and the canonical JSON of the header's four fields followed by `parts`. */
export function signedRowMessage(
  context: string,
  header: SignedRowHeader,
  parts: readonly unknown[],
): Uint8Array {
  return new TextEncoder().encode(
    `${context}\n${canonicalJson([header.id, header.kind, header.deviceId, header.occurredAt, ...parts])}`,
  );
}
