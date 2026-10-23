import { bytesToHex, ed25519 } from './deps.ts';
import { deriveTransportSeed, type DeviceIdentity } from './identity.ts';
import { relayAccessToken, withRelayAccess, type RelayAccessKey } from './relay-access.ts';
import {
  PeerStreamError,
  type ConnectionPath,
  type PeerStream,
  type PeerTransport,
} from './transport.ts';

/**
 * `PeerTransport` over iroh (ADR-15 §1, §9 step 3).
 *
 * The binding is **injected**, and that is the design rather than a testing convenience. The
 * native module is a React Native turbo module (`packages/peer-iroh`), and this package is pure
 * TypeScript that runs in Node: it imports no React Native module and cannot, or its suite
 * stops running on a laptop. So `IrohBinding` below is the shape of what
 * `uniffi-bindgen-react-native` generates, written out by hand; `src/lib/peer.ts` hands the
 * real module in, and the tests hand in a fake. The seam also means `session.ts` runs over
 * this transport without knowing it exists, which was the claim `transport.ts` was written to
 * make.
 *
 * ## Whose key the endpoint has
 *
 * **Not the identity's.** ADR-14 §2 allowed either, and the RUNBOOK left it open. The endpoint
 * binds with `deriveTransportSeed(identity, 'iroh/v1')`, so the key that signs grants,
 * revocations and directory records never enters a 7 MB networking stack. What binds the
 * endpoint to the person is the directory record, which the identity signs and which carries
 * the endpoint id: a peer dials the id its paired partner published, and nothing else.
 *
 * That makes two lookups the caller has to supply, and both are about pairing rather than the
 * network:
 *
 * - `resolve(identityKey)`: the endpoint id a peer published in its signed record, or null.
 * - `identify(endpointId)`: who an incoming connection is, or null to refuse it. **Null is the
 *   default answer for anybody not paired**, so the transport never hands a stream from a
 *   stranger to the session. The session would refuse one anyway (the handshake is signed),
 *   but a stranger should not get as far as spending the phone's CPU on a handshake.
 *
 * `PeerStream.remoteKey` is then the peer's **identity** key, which is what `runSession` checks
 * the handshake against.
 */

/** One QUIC bi-stream: `PeerBiStreamLike` in the generated bindings. */
export interface IrohBiStream {
  /** Writes `bytes` to the stream. */
  send(bytes: ArrayBuffer): Promise<void>;
  /** Up to `max` bytes, or `undefined` once the peer has finished sending. */
  receive(max: number): Promise<ArrayBuffer | undefined>;
  /** Says this side has finished sending; the peer's `receive` then answers `undefined`. */
  finish(): Promise<void>;
  /** Closes the stream. */
  close(): Promise<void>;
}

/** One connection: `PeerConnectionLike`. */
export interface IrohConnection {
  /** Opens a bi-stream to the peer, from the side that dialled. */
  openBi(): Promise<IrohBiStream>;
  /** Waits for the peer to open a bi-stream, on the side that accepted. */
  acceptBi(): Promise<IrohBiStream>;
  /** `direct` or `relay`. */
  path(): string;
  /** The endpoint id TLS authenticated, lowercase hex. */
  remoteEndpointId(): string;
  /** Closes now, for a refusal. A session's connection is let go by dropping it instead. */
  close(): void;
}

/** One bound endpoint: `PeerEndpointLike`. */
export interface IrohEndpoint {
  /** This endpoint's id, lowercase hex. */
  endpointId(): string;
  /** Dials the endpoint id `nodeId`. The signal, when given, aborts the dial. */
  connect(nodeId: string, asyncOpts_?: { signal: AbortSignal }): Promise<IrohConnection>;
  /** Waits for the next incoming connection. Rejects once the endpoint is closed. */
  accept(): Promise<IrohConnection>;
  /** Closes the endpoint, which ends any pending `accept`. */
  close(): Promise<void>;
}

/** The module `@tapp/peer-iroh` exports, or as much of it as this file uses. */
export interface IrohBinding {
  /** The endpoint class, which binds with a secret key and a relay URL. */
  readonly PeerEndpoint: {
    bind(secretKey: ArrayBuffer, relayUrl: string): Promise<IrohEndpoint>;
  };
}

/**
 * What `createIrohTransport` needs: the binding, the identity, the relay, and the two pairing
 * lookups.
 */
export interface IrohTransportOptions {
  /** The native module, or a fake in tests. */
  readonly binding: IrohBinding;
  /**
   * This device's identity. The endpoint binds with a seed derived from it (`irohTransportSeed`),
   * not with its key.
   */
  readonly identity: DeviceIdentity;
  /** The one relay ADR-12 §4 names. Handed in, never written down here (`check-no-egress`). */
  readonly relayUrl: string;
  /**
   * The build's relay release key, or null for a build with none (ADR-15 §9 step 3, amended
   * 2026-09-27). With one, the endpoint presents the token `relay-access.ts` derives for its own
   * id; without one it presents nothing, which only a relay admitting everyone accepts.
   */
  readonly relayAccess?: RelayAccessKey | null;
  /**
   * The token to present, chosen per the build's relay-access flag (`relay-pass.ts`,
   * `createRelayTokenSource`). When given it wins over `relayAccess`; null presents nothing.
   */
  readonly relayToken?: (endpointId: string) => Promise<string | null>;
  /** Identity key → the endpoint id that peer published in its signed directory record. */
  resolve(identityKey: Uint8Array): Promise<string | null>;
  /** Endpoint id → the identity of a paired peer, or null to refuse the connection. */
  identify(endpointId: string): Promise<Uint8Array | null>;
  /** How long a dial may take before the caller falls back to the mailbox. Default 10 s. */
  readonly dialTimeoutMs?: number;
  /** How long an accepted connection may take to open its stream. Default 10 s. */
  readonly streamTimeoutMs?: number;
  /** Bytes per native read. Default 64 KiB, the size of one sealed chunk (`wire.ts`). */
  readonly readBytes?: number;
}

/** A `PeerTransport` over one bound iroh endpoint. */
export interface IrohTransport extends PeerTransport {
  /** This endpoint's id, lowercase hex: what goes in the directory record. */
  readonly endpointId: string;
}

/** The label `deriveTransportSeed` separates the iroh key under (ADR-14 §2). */
export const IROH_TRANSPORT_LABEL = 'iroh/v1';

/** The seed the endpoint binds with. Exported so the tests can assert what crossed the FFI. */
export function irohTransportSeed(identity: DeviceIdentity): Uint8Array {
  return deriveTransportSeed(identity, IROH_TRANSPORT_LABEL);
}

/**
 * The endpoint id this identity binds as, without binding anything.
 *
 * An iroh endpoint id is an Ed25519 public key in lowercase hex, so it is computable here. The
 * directory record can carry it before the native module has loaded, and a test can check the
 * two agree.
 */
export function irohEndpointId(identity: DeviceIdentity): string {
  return bytesToHex(ed25519.getPublicKey(irohTransportSeed(identity)));
}

/** A copy that owns its whole buffer, because the FFI takes an `ArrayBuffer`, not a view. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function asPath(path: string): ConnectionPath {
  return path === 'direct' || path === 'relay' ? path : 'unknown';
}

/**
 * A native failure, renamed for the session.
 *
 * `runSession` records an interrupted session's `reason` as the error's **name**, and the
 * generated errors carry the Rust message, which can include an address. ADR-03 rule 8 keeps key
 * material out of logs, and there is no reason for an address to be in one either.
 */
function streamError(what: string): PeerStreamError {
  return new PeerStreamError(what);
}

async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(streamError(`${what} took longer than ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function refuse(connection: IrohConnection): void {
  try {
    connection.close();
  } catch {
    // Already closed by the other side.
  }
}

function wrapStream(
  remoteKey: Uint8Array,
  connection: IrohConnection,
  stream: IrohBiStream,
  readBytes: number,
): PeerStream {
  return {
    remoteKey,
    path: () => {
      try {
        return asPath(connection.path());
      } catch {
        return 'unknown';
      }
    },
    async send(bytes) {
      try {
        await stream.send(toArrayBuffer(bytes));
      } catch {
        throw streamError('the connection dropped while sending');
      }
    },
    async finish() {
      try {
        await stream.finish();
      } catch {
        throw streamError('the connection dropped while finishing');
      }
    },
    async *receive() {
      for (;;) {
        let chunk: ArrayBuffer | undefined;
        try {
          chunk = await stream.receive(readBytes);
        } catch {
          throw streamError('the connection dropped while receiving');
        }
        if (chunk === undefined) return;
        if (chunk.byteLength > 0) yield new Uint8Array(chunk);
      }
    },
    async close() {
      try {
        await stream.close();
      } catch {
        // Closing what is already gone is how an interrupted session normally ends.
      }
    },
  };
}

/**
 * Binds this device's endpoint and returns it as a `PeerTransport`.
 *
 * Throws if the endpoint cannot bind (no network, a relay URL the crate refuses). The caller
 * treats that exactly like an unreachable peer: the mailbox is the floor (ADR-15 §Context).
 */
export async function createIrohTransport(options: IrohTransportOptions): Promise<IrohTransport> {
  const dialTimeoutMs = options.dialTimeoutMs ?? 10_000;
  const streamTimeoutMs = options.streamTimeoutMs ?? 10_000;
  const readBytes = options.readBytes ?? 64 * 1024;

  // The token is for this endpoint's own id, which is computable before binding.
  const ownId = irohEndpointId(options.identity);
  const relayUrl =
    options.relayToken !== undefined
      ? withRelayAccess(options.relayUrl, await options.relayToken(ownId))
      : options.relayAccess == null
        ? options.relayUrl
        : withRelayAccess(options.relayUrl, relayAccessToken(options.relayAccess, ownId));
  const endpoint = await options.binding.PeerEndpoint.bind(
    toArrayBuffer(irohTransportSeed(options.identity)),
    relayUrl,
  );
  const endpointId = endpoint.endpointId();
  let closed = false;

  return {
    localKey: options.identity.publicKey,
    endpointId,

    async connect(remoteKey) {
      const target = await options.resolve(remoteKey);
      if (target === null) throw streamError('the peer has published no direct address');

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let connection: IrohConnection;
      try {
        connection = await withTimeout(
          endpoint.connect(target, controller ? { signal: controller.signal } : undefined),
          dialTimeoutMs,
          'the dial',
          () => controller?.abort(),
        );
      } catch (error) {
        if (error instanceof PeerStreamError) throw error;
        throw streamError('the peer could not be reached');
      }

      // TLS authenticated *an* endpoint. This is the check that it is the one the peer's own
      // signed record named, and not merely something that answered at that address.
      if (connection.remoteEndpointId() !== target) {
        refuse(connection);
        throw streamError('the endpoint that answered is not the one the peer published');
      }
      let stream: IrohBiStream;
      try {
        stream = await connection.openBi();
      } catch {
        throw streamError('the connection would not open a stream');
      }
      return wrapStream(remoteKey, connection, stream, readBytes);
    },

    async *accept() {
      while (!closed) {
        let connection: IrohConnection;
        try {
          connection = await endpoint.accept();
        } catch {
          // The endpoint was closed, which is how listening stops.
          return;
        }

        let identityKey: Uint8Array | null;
        try {
          identityKey = await options.identify(connection.remoteEndpointId());
        } catch {
          identityKey = null;
        }
        // Not somebody this account paired with. Closed rather than dropped: a dropped object is
        // freed when the garbage collector gets to it, and until then the dialler would sit
        // waiting for a handshake that is never coming.
        if (identityKey === null) {
          refuse(connection);
          continue;
        }

        let stream: IrohBiStream;
        try {
          stream = await withTimeout(connection.acceptBi(), streamTimeoutMs, 'the stream');
        } catch {
          refuse(connection);
          continue;
        }
        yield wrapStream(identityKey, connection, stream, readBytes);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      try {
        await endpoint.close();
      } catch {
        // Already closed.
      }
    },
  };
}
