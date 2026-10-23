import {
  chunkNonce,
  concatBytes,
  createByteReader,
  fromBase64,
  fromUtf8,
  openStream,
  readUint32,
  seal,
  STREAM_CHUNK_BYTES,
  toBase64,
  utf8,
  writeUint32,
  type ByteReader,
} from './deps.ts';
import type { HandshakeHalf } from './identity.ts';
import { PUBLIC_KEY_BYTES, SIGNATURE_BYTES } from './identity.ts';
import {
  attachmentBodySchema,
  batchBodySchema,
  cursorsBodySchema,
  MESSAGE_TYPE,
  ProtocolError,
  toWireRow,
  type Message,
} from './messages.ts';

/**
 * The session on the wire: `.tappbak`, made appendable.
 *
 * ADR-14 §3 does not invent a format, and neither does this file. A session is shaped exactly
 * like a container — a plaintext header that is also the associated data, then chunk-sealed
 * frames — because ADR-03 §Revisit already said what sync would need: *"a container that can
 * be appended to rather than rewritten"*. What changes is only what the header holds
 * (a handshake instead of KDF parameters, since a peer session has no passphrase to stretch)
 * and what the sealed bytes carry (messages instead of a tar).
 *
 *     "TAPPSYN\n"          8 bytes, the same courtesy the container extends a file picker
 *     uint32be helloLen
 *     hello JSON           plaintext, and half of the AAD for every sealed chunk
 *     sealed frames        src/lib/crypto/stream.ts, unchanged
 *
 * Both sides send that header, and the AAD is the hash of the two of them together
 * (`identity.ts`), so neither half can be lifted into another session.
 *
 * **One thing the container does that a session must not.** `openStream` throws when the
 * bytes stop before the final chunk — for a backup that is right, because "a partial restore
 * that looks complete is the worst outcome available here". For a sync it is the *expected*
 * ending: a phone goes through a tunnel mid-transfer. So the session reader yields every
 * message that opened cleanly and *then* throws, and `session.ts` treats the throw as "the
 * call dropped" rather than "discard what arrived". The ULID merge is what makes that safe:
 * everything already applied is idempotent, and the next session asks again from its cursor.
 */

export const SESSION_MAGIC: Uint8Array = utf8('TAPPSYN\n');
export const SESSION_FORMAT = 1;

const MAX_HELLO_BYTES = 4 * 1024;

/**
 * A message is one sealed chunk, so a message is bounded by what a chunk holds.
 *
 * `STREAM_CHUNK_BYTES` is 64 KiB and `openStream` refuses a frame larger than that plus a
 * tag, which is the container's defence against a file that claims a 4 GB chunk. Sync inherits
 * the bound rather than arguing with it: `session.ts` fills batches up to `MAX_BATCH_BYTES`
 * and reads attachments in pieces that fit, so nothing ever reaches this ceiling in practice.
 */
export const MAX_MESSAGE_BYTES = STREAM_CHUNK_BYTES - 5;
/** Leaves room for a row that turns out larger than the estimate that admitted it. */
export const MAX_BATCH_BYTES = 48 * 1024;

/**
 * What a row costs inside an encoded batch, in the unit `MAX_MESSAGE_BYTES` is measured in.
 *
 * UTF-8 bytes, as `encodeMessage` writes them, plus one for the comma. The batch budget used to
 * count `JSON.stringify(row).length`, which is UTF-16 code units: equal to bytes for ASCII and a
 * third of them for Devanagari, so a batch of Nepali notes passed the 48 KiB check and then
 * failed to encode at three times the size (2026-10-16, the review of PR #121).
 */
export function wireRowBytes(row: unknown): number {
  return utf8(JSON.stringify(toWireRow(row))).length + 1;
}

export type SessionRole = 'initiator' | 'responder';

export interface Handshake {
  readonly sessionId: string;
  readonly role: SessionRole;
  readonly half: HandshakeHalf;
  /** The exact bytes as they went over the wire — the transcript's input. */
  readonly bytes: Uint8Array;
}

/**
 * The handshake as it goes over the wire: this side's hello, with the session id and its role,
 * as JSON in a fixed key order so both sides hash the same bytes.
 */
export function encodeHandshake(options: {
  readonly sessionId: string;
  readonly role: SessionRole;
  readonly half: HandshakeHalf;
}): Uint8Array {
  // Key order is fixed by this literal, not by however the object was built, so both sides
  // hash the same bytes for the same handshake.
  const json = JSON.stringify({
    format: SESSION_FORMAT,
    app: 'tapp-sync',
    session: options.sessionId,
    role: options.role,
    identity: toBase64(options.half.identityKey),
    ephemeral: toBase64(options.half.ephemeralKey),
    nonce: toBase64(options.half.nonceBase),
    signature: toBase64(options.half.signature),
  });
  return utf8(json);
}

export function frameHandshake(helloBytes: Uint8Array): Uint8Array {
  if (helloBytes.length > MAX_HELLO_BYTES) throw new ProtocolError('handshake is implausible');
  return concatBytes([SESSION_MAGIC, writeUint32(helloBytes.length), helloBytes]);
}

const bytesField = (value: unknown, length: number, name: string): Uint8Array => {
  if (typeof value !== 'string' || value.length > length * 3) {
    throw new ProtocolError(`handshake ${name} is not a key`);
  }
  let decoded: Uint8Array;
  try {
    decoded = fromBase64(value);
  } catch {
    throw new ProtocolError(`handshake ${name} is not base64`);
  }
  if (decoded.length !== length) throw new ProtocolError(`handshake ${name} is the wrong size`);
  return decoded;
};

/** Reads one side's header off a stream and leaves the sealed frames unread. */
export async function readHandshake(reader: ByteReader): Promise<Handshake> {
  const magic = await reader.exact(SESSION_MAGIC.length);
  if (magic === null || !SESSION_MAGIC.every((byte, index) => magic[index] === byte)) {
    throw new ProtocolError('this is not a TApp sync session');
  }
  const lengthBytes = await reader.exact(4);
  if (lengthBytes === null) throw new ProtocolError('the session has no handshake');
  const length = readUint32(lengthBytes);
  if (length === 0 || length > MAX_HELLO_BYTES) throw new ProtocolError('the handshake is absurd');

  const bytes = await reader.exact(length);
  if (bytes === null) throw new ProtocolError('the session ended inside its handshake');

  let json: unknown;
  try {
    json = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new ProtocolError('the handshake is not readable');
  }
  if (typeof json !== 'object' || json === null) throw new ProtocolError('the handshake is empty');
  const value = json as Record<string, unknown>;
  if (value.format !== SESSION_FORMAT || value.app !== 'tapp-sync') {
    throw new ProtocolError('this session speaks a protocol this build does not');
  }
  if (
    typeof value.session !== 'string' ||
    value.session.length === 0 ||
    value.session.length > 64
  ) {
    throw new ProtocolError('the handshake names no session');
  }
  if (value.role !== 'initiator' && value.role !== 'responder') {
    throw new ProtocolError('the handshake claims no role');
  }
  // `nonce` is the container's random nonce prefix; its length comes from the cipher, and a
  // handshake that disagrees about it is not one this build can open.
  const nonceBase = bytesField(value.nonce, 16, 'nonce');

  return {
    sessionId: value.session,
    role: value.role,
    bytes,
    half: {
      identityKey: bytesField(value.identity, PUBLIC_KEY_BYTES, 'identity'),
      ephemeralKey: bytesField(value.ephemeral, PUBLIC_KEY_BYTES, 'ephemeral'),
      nonceBase,
      signature: bytesField(value.signature, SIGNATURE_BYTES, 'signature'),
    },
  };
}

/** `uint8 type | uint32be length | body`, inside the sealed stream. */
export function encodeMessage(message: Message): Uint8Array {
  const body =
    message.type === MESSAGE_TYPE.chunk
      ? message.bytes
      : message.type === MESSAGE_TYPE.done
        ? new Uint8Array(0)
        : utf8(
            JSON.stringify(
              // A batch's rows lose their local-only fields here and nowhere else (`toWireRow`).
              message.type === MESSAGE_TYPE.batch
                ? { ...message.body, rows: message.body.rows.map(toWireRow) }
                : message.body,
            ),
          );
  if (body.length > MAX_MESSAGE_BYTES) throw new ProtocolError('a message is too large to send');
  return concatBytes([Uint8Array.of(message.type), writeUint32(body.length), body]);
}

function decodeMessage(type: number, body: Uint8Array): Message {
  const json = () => {
    try {
      return JSON.parse(fromUtf8(body)) as unknown;
    } catch {
      throw new ProtocolError('a message body is not readable');
    }
  };
  switch (type) {
    case MESSAGE_TYPE.cursors:
      return { type: MESSAGE_TYPE.cursors, body: cursorsBodySchema.parse(json()) };
    case MESSAGE_TYPE.batch:
      return { type: MESSAGE_TYPE.batch, body: batchBodySchema.parse(json()) };
    case MESSAGE_TYPE.attachment:
      return { type: MESSAGE_TYPE.attachment, body: attachmentBodySchema.parse(json()) };
    case MESSAGE_TYPE.chunk:
      return { type: MESSAGE_TYPE.chunk, bytes: body };
    case MESSAGE_TYPE.done:
      return { type: MESSAGE_TYPE.done };
    default:
      throw new ProtocolError(`unknown message type ${type}`);
  }
}

/**
 * Seals messages into container frames — one chunk per message, flushed as it is written.
 *
 * This is the one place the spike could not reuse `sealStream`, and the reason is worth
 * recording rather than working around. `sealStream` is a **batch** sealer: it rechunks its
 * input to 64 KiB and holds one chunk back, because a backup must mark its last chunk and
 * which chunk is last "is only knowable once the next one fails to arrive". Both properties
 * are right for a file and fatal for a conversation — the first message of a session is a
 * question, and a sealer that will not emit it until 64 KiB have accumulated behind it means
 * both phones sit waiting for an answer to a question neither has sent. The loopback suite
 * deadlocked on exactly that, in the first test written.
 *
 * So: seal each message as its own chunk, emit it immediately, and end the stream with a final
 * empty chunk carrying the final flag. Same frame layout, same nonce scheme, same key — an
 * `openStream` that can read a `.tappbak` reads this without knowing the difference, which is
 * what keeps ADR-03 §Revisit's "one container" promise true. What it costs is a tag per
 * message instead of per 64 KiB, which on a 1 000-entry sync is a few kilobytes.
 */
export async function* sealMessages(
  key: Uint8Array,
  nonceBase: Uint8Array,
  associatedData: Uint8Array,
  messages: AsyncIterable<Message>,
): AsyncIterable<Uint8Array> {
  let index = 0;
  const frame = (plaintext: Uint8Array, final: boolean): Uint8Array => {
    const ciphertext = seal(key, chunkNonce(nonceBase, index, final), plaintext, associatedData);
    index += 1;
    return concatBytes([writeUint32(ciphertext.length), ciphertext]);
  };

  for await (const message of messages) yield frame(encodeMessage(message), false);
  // The empty final chunk is what tells the reader the session ended rather than stopped.
  yield frame(new Uint8Array(0), true);
}

/**
 * Opens sealed frames and yields the messages inside them.
 *
 * Yields as it goes and throws at the end if the stream stopped early, in that order. See the
 * note at the top of this file: the caller keeps what it has applied.
 */
export async function* openMessages(
  key: Uint8Array,
  nonceBase: Uint8Array,
  associatedData: Uint8Array,
  frames: AsyncIterable<Uint8Array>,
): AsyncIterable<Message> {
  const reader = createByteReader(openStream(key, nonceBase, frames, associatedData));
  for (;;) {
    const header = await reader.exact(5);
    if (header === null) return;
    const length = readUint32(header, 1);
    if (length > MAX_MESSAGE_BYTES) throw new ProtocolError('a message claims an absurd length');
    const body = await reader.exact(length);
    if (body === null) throw new ProtocolError('the session ended inside a message');
    yield decodeMessage(header[0]!, body);
  }
}
