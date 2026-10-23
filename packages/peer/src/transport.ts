/**
 * The seam the two spikes meet at.
 *
 * ADR-14 §Decision gives Spike A "a Rust crate exposing `bind`, `connect(key)`, `open_bi`,
 * and a byte-stream API" and Spike B "Hyperswarm + one Hypercore per device". Written out
 * as interfaces, those are the same interface: *reach a device by its public key, and get a
 * duplex of bytes*. Everything above this file is written once and measured twice.
 *
 * What is deliberately **not** here:
 *
 * - **No discovery.** Pairing (a scanned QR in A, a blind-pairing invite in B) produces a
 *   public key by means the transport owns. This interface starts once a key is known.
 * - **No reliability guarantees beyond "in order or not at all".** Both candidates give
 *   ordered streams (QUIC in A, Hypercore in B). The session layer assumes a stream can
 *   stop at any byte, and never that it can arrive scrambled.
 * - **No store-and-forward.** §Context's always-on node is a peer like any other: the mirror
 *   holds sealed frames addressed to a key, so to this interface it is simply a device that
 *   is always dialable.
 */

/** An ordered, reliable, bidirectional stream of bytes to one peer. */
export interface PeerStream {
  /** The remote's Ed25519 public key, as the transport authenticated it. */
  readonly remoteKey: Uint8Array;
  /** How the connection is currently carried. Spike A's relayed→direct gate reads this. */
  readonly path: () => ConnectionPath;
  /** Sends bytes to the peer, in order after anything sent before. */
  send(bytes: Uint8Array): Promise<void>;
  /**
   * "I will send nothing further", without hanging up.
   *
   * The spike found this the hard way. `openStream` ends a container by verifying the final
   * chunk and then checking that nothing follows it — ADR-03's defence against bytes appended
   * to a backup — and "nothing follows" is a question about the *end of the stream*, not the
   * end of the data. A transport with no way to say "that was the last byte" leaves both sides
   * holding the line: each has finished sending, and each is waiting to learn that the other
   * has. Half-close is what both candidates already have (a QUIC stream is finished in one
   * direction at a time; a Hypercore append ends) and what the interface therefore states.
   */
  finish(): Promise<void>;
  /** Yields until the peer finishes or the stream breaks. */
  receive(): AsyncIterable<Uint8Array>;
  /** Ends the stream in both directions. */
  close(): Promise<void>;
}

/** ADR-14 §Owed measurements: "relayed→direct upgrade rate per carrier pair". */
export type ConnectionPath = 'direct' | 'relay' | 'local' | 'unknown';

/** A way of reaching other devices by their public key, and of being reached. */
export interface PeerTransport {
  /** This device's Ed25519 public key — the same identity ADR-03 already owns (§2). */
  readonly localKey: Uint8Array;
  /** Dial a peer by public key. Rejects if no path exists within the transport's timeout. */
  connect(remoteKey: Uint8Array): Promise<PeerStream>;
  /** Streams opened by peers dialling us. */
  accept(): AsyncIterable<PeerStream>;
  /** Stops this device being reachable through the transport. */
  close(): Promise<void>;
}

/** Thrown when a stream ends in the middle of something the session was reading. */
export class PeerStreamError extends Error {
  /** A stream error with `message` as its explanation. */
  constructor(message: string) {
    super(message);
    this.name = 'PeerStreamError';
  }
}
