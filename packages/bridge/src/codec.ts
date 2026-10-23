/**
 * The translation (ADR-22 §1): one foreign object to zero or more `bridge:` rows, each naming its
 * origin. A codec is pure. It does not sign, send, remember or look anything up; it says which
 * foreign subject the rows are for and the loop finds the patient, so a codec cannot address a
 * row to someone the bridge was never paired with.
 *
 * **Three outcomes**, the loop's deferral rule:
 * - `write`: rows for one foreign subject, signed and deposited by the outbox (an effect);
 * - `defer`: not yet, because something it needs has not arrived (a report's observations, a
 *   pairing for its subject); the item is kept and retried on the next run;
 * - `refuse`: never, with a reason the inbox may pass back to the foreign side.
 * @module
 */

import { bytesToHex, sha256Bytes } from '@cosys/crypto';
import {
  FOREIGN_TEXT_MAX,
  type BridgeBodyInput,
  type BridgeKind,
  type ForeignObject,
} from '@cosys/record/bridge';

import type { Received } from './inbox.ts';

/** A row the codec proposes, before the bridge signs it. */
export interface BridgeRowDraft<K extends BridgeKind = BridgeKind> {
  /** The `bridge:` row kind the draft becomes. */
  readonly kind: K;
  /** When the foreign side says it happened: a result's collection or report time. */
  readonly occurredAt: string;
  /** The row's body in the shape its kind takes, unsigned. */
  readonly body: BridgeBodyInput<K>;
}

/**
 * What a codec makes of one foreign item: `write` with rows for one foreign subject, `defer` to
 * try again on the next run, or `refuse` with a reason.
 */
export type Decoded =
  | {
      readonly outcome: 'write';
      readonly subject: string;
      readonly rows: readonly BridgeRowDraft[];
    }
  /** `subject`, when the codec knows it, so an erasure can drop what waits for that patient. */
  | { readonly outcome: 'defer'; readonly reason: string; readonly subject?: string }
  | { readonly outcome: 'refuse'; readonly reason: string };

/** The translation for one foreign protocol. Pure: it does not sign, send, remember or look up. */
export interface Codec<Foreign> {
  /** Reads one received item. If it throws, the loop refuses the item. */
  decode(item: Received<Foreign>): Decoded;
}

/** The foreign object as an import keeps it: verbatim when small, by its digest when not. */
export function keepForeign(raw: Received<unknown>['raw']): ForeignObject {
  if (raw.text.length > 0 && raw.text.length <= FOREIGN_TEXT_MAX)
    return { mediaType: raw.mediaType, text: raw.text };
  const bytes = new TextEncoder().encode(raw.text);
  return { mediaType: raw.mediaType, sha256: bytesToHex(sha256Bytes(bytes)), bytes: bytes.length };
}

/** The origin a draft names, or `null` (a receipt answers a request and names none). */
export function originOfDraft(draft: BridgeRowDraft): string | null {
  const refs =
    (draft.body as { readonly refs?: readonly { readonly role: string; readonly to: string }[] })
      .refs ?? [];
  return refs.find((ref) => ref.role === 'origin')?.to ?? null;
}
