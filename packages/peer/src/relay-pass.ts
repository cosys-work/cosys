import { relayAccessToken, type RelayAccessKey } from './relay-access.ts';

/**
 * The relay pass: Play Integrity behind a flag, the phone's half (ADR-15 §9 step 3, second
 * amendment of 2026-09-27).
 *
 * The founder's follow-up to the derived token (`relay-access.ts`): a stronger, per-install check,
 * **behind a flag**, with the derived token as the default until the Google side exists; and
 * *"Relay checks it, no Google call."* So the relay does all of it. The phone asks the relay's
 * access routes for a nonce bound to its endpoint id, asks Google Play for a **Classic** integrity
 * token over that nonce (Google Play services on the device, no connection from the app), and
 * trades the token at the relay for a day's **pass**, which it presents where it presented the
 * derived token. The relay decrypts and verifies the token itself (`packages/peer-relay`), and
 * nothing is stored on either side.
 */

/** Which token the phone presents, and which the relay accepts. One switch. */
export type RelayAccessMode = 'derived-token' | 'play-integrity' | 'both';
/** Every mode there is; `parseRelayAccessMode` reads anything outside it as the default. */
export const RELAY_ACCESS_MODES: readonly RelayAccessMode[] = [
  'derived-token',
  'play-integrity',
  'both',
];
/** The current path, and what every build and the relay are until somebody sets the flag. */
export const DEFAULT_RELAY_ACCESS_MODE: RelayAccessMode = 'derived-token';

/** Anything that is not one of the three reads as the default. */
export function parseRelayAccessMode(value: unknown): RelayAccessMode {
  return RELAY_ACCESS_MODES.includes(value as RelayAccessMode)
    ? (value as RelayAccessMode)
    : DEFAULT_RELAY_ACCESS_MODE;
}

/** The pass's version prefix. The relay routes a token by it (`v1.` is the derived token). */
export const RELAY_PASS_VERSION = 'p1';

const ENDPOINT_ID = /^[0-9a-f]{64}$/;
const PASS = /^p1\.([a-z0-9-]{1,16})\.([0-9]{1,12})\.[0-9a-f]{64}$/;
/** What Play Integrity accepts as a Classic nonce: base64 web-safe, 16 to 500 characters. */
const NONCE = /^[A-Za-z0-9_-]{16,500}={0,2}$/;

/** A pass's key name and expiry, or null for anything that is not one. The phone never verifies it. */
export function parseRelayPass(token: unknown): { kid: string; expiresAt: number } | null {
  if (typeof token !== 'string') return null;
  const match = PASS.exec(token);
  if (match === null) return null;
  return { kid: match[1]!, expiresAt: Number(match[2]) };
}

/** Google Play's Classic integrity token over one nonce (`modules/play-integrity`). */
export type IntegrityProvider = (nonce: string) => Promise<string>;

/** The relay's answer to a verdict. */
export interface RelayPassGrant {
  /**
   * The pass itself, presented where the derived token was. Its shape is the one `parseRelayPass`
   * reads.
   */
  readonly pass: string;
  /** Seconds the pass is good for, from now. The phone times it on its own clock from this. */
  readonly lifetimeSeconds: number;
}

/** The relay's two access routes (`createRelayAccessClient`, or a fake). */
export interface RelayAccessRoutes {
  /** Asks the relay for a nonce bound to this endpoint id. */
  challenge(endpointId: string, signal?: AbortSignal): Promise<string>;
  /** Trades Google Play's integrity token over the relay's nonce for a pass. */
  pass(
    request: {
      readonly endpointId: string;
      readonly nonce: string;
      readonly integrityToken: string;
    },
    signal?: AbortSignal,
  ): Promise<RelayPassGrant>;
}

/** What happened while choosing a token, for the app's log. Tags only, never a token. */
export type RelayAccessEvent =
  | { readonly kind: 'pass-issued' }
  | { readonly kind: 'pass-reused' }
  | { readonly kind: 'config-fallback' }
  | { readonly kind: 'pass-backoff' }
  | {
      readonly kind: 'pass-failed';
      readonly stage: 'challenge' | 'integrity' | 'relay';
      readonly error: unknown;
    };

/**
 * What is kept per endpoint id: the pass and when to renew it, or none and until when not to ask
 * Google again. Times are this phone's clock, in ms.
 */
export interface HeldPass {
  /** The held pass, or null while backing off after a failure. */
  readonly pass: string | null;
  /**
   * When to buy the next pass, in ms on this phone's clock: the pass's lifetime less the renew
   * margin. 0 when there is no pass.
   */
  readonly renewAt: number;
  /**
   * Until when not to ask Google again, in ms on this phone's clock. 0 when there is no backoff.
   */
  readonly backoffUntil: number;
}

/** Held passes, in memory, for the life of the process. */
export type RelayPassCache = Map<string, HeldPass>;

/** An empty in-memory pass cache, for token sources that should share held passes. */
export function createRelayPassCache(): RelayPassCache {
  return new Map();
}

/**
 * Where held passes survive a restart, so a phone asks Google about once a day rather than once
 * per launch: the app keeps them beside the endpoint key (`src/data/peer/relay-pass-store.ts`).
 * Best effort: a store that fails is the same as no store.
 */
export interface RelayPassStore {
  /** The held pass saved for this endpoint id, or null when there is none. */
  load(endpointId: string): Promise<HeldPass | null>;
  /** Keeps the held pass for this endpoint id, replacing the one before it. */
  save(endpointId: string, held: HeldPass): Promise<void>;
}

/** Renew a pass when less than this is left of it. Tunable in `peer-transport-config.ts`. */
export const RELAY_PASS_RENEW_MARGIN_MS = 60 * 60 * 1000;

/**
 * How long not to ask Google again after the relay refused a verdict (403): the device or the
 * binary will not have changed in an hour, and every request spends the project's daily quota.
 */
export const RELAY_PASS_REFUSED_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** How long not to ask Google again after Google Play itself failed or stalled. */
export const RELAY_PASS_INTEGRITY_BACKOFF_MS = 6 * 60 * 60 * 1000;

/**
 * How long each step of buying a pass may take: the relay's nonce, Google Play's token, the
 * relay's pass. A Tasks callback that never fires would otherwise hold the bind, and with it the
 * sync run and its mailbox deposit, until the app restarts. Ten seconds covers a Classic request
 * on a cold budget phone (a few seconds) with room; past it the bind falls back exactly as for a
 * refusal. The step's request is aborted with it. Tunable in `peer-transport-config.ts`.
 */
export const RELAY_PASS_STEP_TIMEOUT_MS = 10_000;

/** A step that did not answer in time. Its `code` is what the app logs as the tag. */
export class RelayPassTimeoutError extends Error {
  /** The tag the app logs for this failure. */
  readonly code = 'RELAY_PASS_TIMEOUT';
  /** `what` names the step and `ms` the bound it overran; both go in the message. */
  constructor(what: string, ms: number) {
    super(`${what} took longer than ${ms} ms`);
    this.name = 'RelayPassTimeoutError';
  }
}

/**
 * The bind cannot have the relay: `play-integrity` and no pass. Thrown rather than answered as
 * null, so the endpoint does not bind relay-less and get held that way for a whole foreground
 * session; the caller treats it as a failed bind and tries again on the next run.
 */
export class RelayPassUnavailableError extends Error {
  /** The tag the app logs for this failure. */
  readonly code = 'RELAY_PASS_UNAVAILABLE';
  constructor() {
    super('play-integrity and no relay pass');
    this.name = 'RelayPassUnavailableError';
  }
}

/**
 * The same shape as `withTimeout` in `iroh.ts`: a race against a timer that is always cleared,
 * and the step's own request aborted when the timer wins.
 */
async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RelayPassTimeoutError(what, ms));
    }, ms);
  });
  try {
    // `Promise.resolve().then` so a step that throws synchronously is a rejection too.
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What `createRelayTokenSource` needs: the build's flag, what the build can do, and the tunables.
 */
export interface RelayTokenSourceOptions {
  /** The build's flag. */
  readonly mode: RelayAccessMode;
  /** The derived token's release key, or null when the build carries none. */
  readonly releaseKey: RelayAccessKey | null;
  /** Null where Play Integrity cannot run: no project number in the build, no native module. */
  readonly integrity: IntegrityProvider | null;
  /** Null where the build names no relay. */
  readonly relay: RelayAccessRoutes | null;
  /** Held passes to share with other sources. Default: a fresh cache of its own. */
  readonly cache?: RelayPassCache;
  /** Where held passes survive a restart. Default: none, so a pass lasts as long as the process. */
  readonly store?: RelayPassStore | null;
  /** The clock, in ms. Default `Date.now`. */
  readonly now?: () => number;
  /**
   * Renew a pass when less than this is left of it, in ms. Default `RELAY_PASS_RENEW_MARGIN_MS`.
   */
  readonly renewMarginMs?: number;
  /** Per step: the nonce, Google Play's token, the pass. Default `RELAY_PASS_STEP_TIMEOUT_MS`. */
  readonly stepTimeoutMs?: number;
  /**
   * How long not to ask Google again after the relay refused a verdict (403), in ms. Default
   * `RELAY_PASS_REFUSED_BACKOFF_MS`.
   */
  readonly refusedBackoffMs?: number;
  /**
   * How long not to ask Google again after Google Play failed or stalled, in ms. Default
   * `RELAY_PASS_INTEGRITY_BACKOFF_MS`.
   */
  readonly integrityBackoffMs?: number;
  /** Called with each `RelayAccessEvent`, for the app's log. */
  readonly onEvent?: (event: RelayAccessEvent) => void;
}

/** The source: a token per endpoint id, and when that endpoint's pass should be renewed. */
export interface RelayTokenSource {
  (endpointId: string): Promise<string | null>;
  /** When the held pass for this endpoint should be renewed, or null when it has none. */
  renewAt(endpointId: string): number | null;
}

/**
 * The token one endpoint presents to the relay, or null for none. The rule, as ADR-15 states it:
 *
 * - `derived-token`: the derived token, as before. No Play Integrity call, no access route.
 * - `play-integrity`: a pass, or **`RelayPassUnavailableError`**: a bind that cannot have the
 *   relay fails, and the next run tries again, rather than binding relay-less.
 * - `both`: a pass, and the derived token when a pass cannot be had.
 * - **A build that asks for Play Integrity and cannot do it** (no project number, no native
 *   module, no relay) is treated as `derived-token` and says so (`config-fallback`), so a
 *   half-configured build is never worse off than the current path.
 *
 * Google is asked at most once per endpoint at a time (concurrent binds share one request), not
 * again while a held pass is good, and not for 24 hours after the relay refused a verdict or 6
 * after Google Play failed: every request spends the project's daily quota.
 */
export function createRelayTokenSource(options: RelayTokenSourceOptions): RelayTokenSource {
  const cache = options.cache ?? createRelayPassCache();
  const store = options.store ?? null;
  const now = options.now ?? (() => Date.now());
  const margin = options.renewMarginMs ?? RELAY_PASS_RENEW_MARGIN_MS;
  const stepMs = options.stepTimeoutMs ?? RELAY_PASS_STEP_TIMEOUT_MS;
  const refusedBackoff = options.refusedBackoffMs ?? RELAY_PASS_REFUSED_BACKOFF_MS;
  const integrityBackoff = options.integrityBackoffMs ?? RELAY_PASS_INTEGRITY_BACKOFF_MS;
  const emit = options.onEvent ?? (() => {});
  const { integrity, relay, releaseKey } = options;
  const inFlight = new Map<string, Promise<string | null>>();

  const derived = (endpointId: string): string | null =>
    releaseKey === null ? null : relayAccessToken(releaseKey, endpointId);

  /** A pass could not be had: the derived token under `both`, a failed bind otherwise. */
  const without = (endpointId: string): string | null => {
    if (options.mode === 'both') return derived(endpointId);
    throw new RelayPassUnavailableError();
  };

  const remember = async (endpointId: string, held: HeldPass) => {
    cache.set(endpointId, held);
    try {
      await store?.save(endpointId, held);
    } catch {
      // Best effort: the next launch asks again, which is what happened before there was a store.
    }
  };

  const recall = async (endpointId: string): Promise<HeldPass | undefined> => {
    const inMemory = cache.get(endpointId);
    if (inMemory !== undefined || store === null) return inMemory;
    try {
      const stored = await store.load(endpointId);
      if (stored !== null) cache.set(endpointId, stored);
      return stored ?? undefined;
    } catch {
      return undefined;
    }
  };

  const buy = async (endpointId: string): Promise<string | null> => {
    const held = await recall(endpointId);
    if (held?.pass != null && held.renewAt > now()) {
      emit({ kind: 'pass-reused' });
      return held.pass;
    }
    if (held !== undefined && held.backoffUntil > now()) {
      emit({ kind: 'pass-backoff' });
      return without(endpointId);
    }

    const failed = async (
      stage: 'challenge' | 'integrity' | 'relay',
      error: unknown,
    ): Promise<string | null> => {
      emit({ kind: 'pass-failed', stage, error });
      const refused = stage === 'relay' && (error as { status?: unknown })?.status === 403;
      const wait = stage === 'integrity' ? integrityBackoff : refused ? refusedBackoff : 0;
      if (wait > 0)
        await remember(endpointId, { pass: null, renewAt: 0, backoffUntil: now() + wait });
      return without(endpointId);
    };

    let nonce: string;
    try {
      nonce = await withTimeout((s) => relay!.challenge(endpointId, s), stepMs, 'the relay nonce');
      if (!NONCE.test(nonce)) {
        throw new Error('the relay answered with something that is not a nonce');
      }
    } catch (error) {
      return failed('challenge', error);
    }
    let integrityToken: string;
    try {
      integrityToken = await withTimeout(
        () => integrity!(nonce),
        stepMs,
        'the Play Integrity token',
      );
    } catch (error) {
      return failed('integrity', error);
    }
    try {
      const grant = await withTimeout(
        (s) => relay!.pass({ endpointId, nonce, integrityToken }, s),
        stepMs,
        'the relay pass',
      );
      if (parseRelayPass(grant.pass) === null || !(grant.lifetimeSeconds > 0)) {
        throw new Error('the relay answered with something that is not a pass');
      }
      await remember(endpointId, {
        pass: grant.pass,
        renewAt: now() + Math.max(0, grant.lifetimeSeconds * 1000 - margin),
        backoffUntil: 0,
      });
      emit({ kind: 'pass-issued' });
      return grant.pass;
    } catch (error) {
      return failed('relay', error);
    }
  };

  const source = async (endpointId: string): Promise<string | null> => {
    if (options.mode === 'derived-token') return derived(endpointId);
    if (integrity === null || relay === null) {
      emit({ kind: 'config-fallback' });
      return derived(endpointId);
    }
    // One request per endpoint at a time: concurrent binds share it.
    const pending = inFlight.get(endpointId);
    if (pending !== undefined) return pending;
    const started = buy(endpointId).finally(() => inFlight.delete(endpointId));
    inFlight.set(endpointId, started);
    return started;
  };

  return Object.assign(source, {
    renewAt(endpointId: string): number | null {
      const held = cache.get(endpointId);
      return held?.pass != null ? held.renewAt : null;
    },
  });
}

/** A refusal from the relay's access routes. `status` is logged as `HTTP_<status>`. */
export class RelayAccessError extends Error {
  /** The HTTP status the relay answered with, or 502 when its answer held no nonce or no pass. */
  readonly status: number;
  /** `message` is the relay's own error text when it gave one, else the route's path. */
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RelayAccessError';
    this.status = status;
  }
}

/** What `createRelayAccessClient` needs. */
export interface RelayAccessClientOptions {
  /** The access routes' base URL: the relay's hostname, their port. Configuration, never a constant here. */
  readonly server: string;
  /** Injected so tests need no relay. */
  readonly fetch?: typeof globalThis.fetch;
  /** Its own bound, the same as a step's: `RELAY_PASS_STEP_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

/**
 * The client of the relay's two access routes. **It names no host** (`check-no-egress.mjs`): the
 * base URL is the relay's, derived in `src/data/peer/endpoint.ts`. A caller's `signal` aborts the
 * request, so a step that timed out does not leave its fetch running.
 */
export function createRelayAccessClient(options: RelayAccessClientOptions): RelayAccessRoutes {
  const server = options.server.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? RELAY_PASS_STEP_TIMEOUT_MS;

  async function post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted === true) controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await doFetch(`${server}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const said = (parsed as { error?: unknown } | null)?.error;
        throw new RelayAccessError(response.status, typeof said === 'string' ? said : path);
      }
      return (parsed ?? {}) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async challenge(endpointId, signal) {
      if (!ENDPOINT_ID.test(endpointId)) throw new Error('an endpoint id is 64 lowercase hex');
      const answer = await post('/access/challenge', { endpoint: endpointId }, signal);
      if (typeof answer.nonce !== 'string') throw new RelayAccessError(502, 'no nonce');
      return answer.nonce;
    },
    async pass({ endpointId, nonce, integrityToken }, signal) {
      const answer = await post(
        '/access/pass',
        { endpoint: endpointId, nonce, token: integrityToken },
        signal,
      );
      if (typeof answer.pass !== 'string' || typeof answer.lifetimeSeconds !== 'number') {
        throw new RelayAccessError(502, 'no pass');
      }
      return { pass: answer.pass, lifetimeSeconds: answer.lifetimeSeconds };
    },
  };
}
