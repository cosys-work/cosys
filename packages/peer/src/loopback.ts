import {
  PeerStreamError,
  type ConnectionPath,
  type PeerStream,
  type PeerTransport,
} from './transport.ts';

/**
 * A transport made of two queues and a set of faults, so that ADR-14 §Decision's test matrix
 * can be run before either candidate transport exists.
 *
 * It is not a simulation of a network and does not pretend to be one — there is no latency
 * model, no bandwidth, no CGNAT. What it does model is the only three things the layers above
 * it can actually observe: bytes arrive in order, a stream can stop at any byte, and a peer
 * can be unreachable. Everything ADR-14 says is environmental — carrier NAT, Android async
 * FFI, RAM beside ExecuTorch — is measured on handsets and cannot be faked here, which is the
 * point of the ADR's last rejected alternative: *"Deciding on paper."*
 *
 * What it is genuinely good for is the failure the two-handset test would otherwise find at
 * the worst moment: that the *protocol* cannot resume, cannot be interrupted safely, or leaks
 * a projected field. Those are decidable in a millisecond, and finding them on a VPS in
 * Kathmandu with two phones and a stopwatch would be a poor use of the trip.
 */

interface Channel {
  push(bytes: Uint8Array): void;
  end(error?: Error): void;
  read(): AsyncIterable<Uint8Array>;
}

function createChannel(): Channel {
  const queue: Uint8Array[] = [];
  let waiting: (() => void) | null = null;
  let ended = false;
  let failure: Error | null = null;

  const wake = () => {
    const resume = waiting;
    waiting = null;
    resume?.();
  };

  return {
    push(bytes) {
      if (ended) return;
      queue.push(bytes);
      wake();
    },
    end(error) {
      if (ended) return;
      ended = true;
      failure = error ?? null;
      wake();
    },
    async *read() {
      for (;;) {
        while (queue.length > 0) yield queue.shift()!;
        if (ended) {
          if (failure !== null) throw failure;
          return;
        }
        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
    },
  };
}

/** The faults a loopback network starts with. */
export interface LoopbackFaults {
  /**
   * Break every live stream once this many bytes have crossed it, in either direction.
   * The ADR's "kill the app mid-transfer": from the protocol's side, a killed app and a lost
   * tunnel are the same event.
   */
  cutAfterBytes?: number;
  /** Keys that cannot currently be dialled, and cannot dial. Airplane mode. */
  offline?: ReadonlySet<string>;
}

const keyName = (key: Uint8Array) =>
  Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');

/** An in-memory network that peers join by public key, for tests. */
export interface LoopbackNetwork {
  /**
   * Adds a peer under `publicKey` and returns its transport. `path` (default `direct`) is what
   * streams dialled to this peer report as their path.
   */
  join(publicKey: Uint8Array, path?: ConnectionPath): PeerTransport;
  /** Takes a peer off the network, or puts it back: an offline peer cannot dial or be dialled. */
  setOffline(publicKey: Uint8Array, offline: boolean): void;
  /** Break live streams after this many more bytes. `null` clears the fault. */
  cutAfter(bytes: number | null): void;
  /** Total bytes that have crossed the network — the harness's throughput denominator. */
  readonly bytes: () => number;
}

/**
 * A loopback network with the given faults. Dialling a key that has not joined, or one that is
 * offline, rejects with `PeerStreamError`; a cut breaks every live stream with the same error.
 */
export function createLoopbackNetwork(faults: LoopbackFaults = {}): LoopbackNetwork {
  const offline = new Set(faults.offline ?? []);
  const inboxes = new Map<string, { push(stream: PeerStream): void; path: ConnectionPath }>();
  const live = new Set<{ break(): void }>();
  let budget = faults.cutAfterBytes ?? null;
  let total = 0;

  const spend = (bytes: number) => {
    total += bytes;
    if (budget === null) return false;
    budget -= bytes;
    if (budget > 0) return false;
    budget = null;
    for (const stream of [...live]) stream.break();
    return true;
  };

  const pair = (local: Uint8Array, remote: Uint8Array, path: ConnectionPath) => {
    const toRemote = createChannel();
    const toLocal = createChannel();

    const make = (remoteKey: Uint8Array, out: Channel, inbound: Channel): PeerStream => ({
      remoteKey,
      path: () => path,
      async send(bytes) {
        out.push(bytes);
        // The cut happens after the bytes are queued, so a stream always breaks part-way
        // through something rather than tidily between two messages.
        spend(bytes.length);
      },
      async finish() {
        out.end();
      },
      receive: () => inbound.read(),
      async close() {
        out.end();
        inbound.end();
      },
    });

    const handle = {
      break() {
        live.delete(handle);
        const error = new PeerStreamError('the connection dropped');
        toRemote.end(error);
        toLocal.end(error);
      },
    };
    live.add(handle);

    return {
      local: make(remote, toRemote, toLocal),
      remote: make(local, toLocal, toRemote),
    };
  };

  return {
    bytes: () => total,
    cutAfter(bytes) {
      budget = bytes;
    },
    setOffline(publicKey, value) {
      const name = keyName(publicKey);
      if (value) offline.add(name);
      else offline.delete(name);
    },
    join(publicKey, path: ConnectionPath = 'direct') {
      const name = keyName(publicKey);
      const queue: PeerStream[] = [];
      let waiting: ((stream: PeerStream) => void) | null = null;

      inboxes.set(name, {
        path,
        push(stream) {
          const resume = waiting;
          waiting = null;
          if (resume !== null) resume(stream);
          else queue.push(stream);
        },
      });

      return {
        localKey: publicKey,
        async connect(remoteKey) {
          const remoteName = keyName(remoteKey);
          const inbox = inboxes.get(remoteName);
          if (inbox === undefined) throw new PeerStreamError('no such peer on this network');
          if (offline.has(name) || offline.has(remoteName)) {
            throw new PeerStreamError('the peer is not reachable');
          }
          const { local, remote } = pair(publicKey, remoteKey, inbox.path);
          inbox.push(remote);
          return local;
        },
        async *accept() {
          for (;;) {
            if (queue.length > 0) {
              yield queue.shift()!;
              continue;
            }
            yield await new Promise<PeerStream>((resolve) => {
              waiting = resolve;
            });
          }
        },
        async close() {
          inboxes.delete(name);
        },
      };
    },
  };
}
