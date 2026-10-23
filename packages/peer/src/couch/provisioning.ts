import { bytesToHex, ed25519, toBase64, utf8 } from '../deps.ts';
import { capabilityCommitment, erasureCapability } from '../holder.ts';
import type { DeviceIdentity } from '../identity.ts';
import type { MailboxReceipt } from '../mailbox.ts';
import type { TokenSource } from './client.ts';
import { mailboxDatabaseName, type MailboxScope } from './mailbox.ts';

/**
 * The client half of the provisioning service (ADR-15 §2).
 *
 * `server/provision.mjs` is the only part of the estate that knows anything: it issues a nonce,
 * verifies an Ed25519 signature over it, and mints a short-lived ES256 token scoped to one
 * database and one role. Until now the only thing that performed that exchange was an
 * integration test doing it by hand with `node:crypto` — so the protocol had a server and no
 * client, and every reader had to take on trust that a phone could speak it.
 *
 * ## It names no host
 *
 * `scripts/check-no-egress.mjs` asserts that this package names no hostname, *"so that every
 * host it can ever reach arrives as injected configuration a reviewer sees"*. `server` is a
 * parameter, `fetch` is a parameter, and there is no default for the first.
 *
 * ## A signature is the whole account system
 *
 * There is no password, no session and no recovery, because a key that can sign is a key that
 * can collect its own mail and a key that cannot is nobody. What that costs is that **every**
 * request here needs the identity's secret — which is why this takes a `DeviceIdentity` rather
 * than a token, and why it lives behind `src/lib/peer.ts` where a screen cannot reach it.
 */

/** A request the provisioning service refused, or answered without what was asked for. */
export class ProvisioningError extends Error {
  /**
   * The HTTP status the service answered with, or 502 when its answer lacked the nonce or the token
   * asked for.
   */
  readonly status: number;
  /** The service's answer body, when it sent JSON. Only the erasure path reads it. */
  readonly body: unknown;
  /**
   * `message` is the service's own `error` text when it sent one; `body` is its parsed JSON answer,
   * or null.
   */
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = 'ProvisioningError';
    this.status = status;
    this.body = body;
  }
}

/**
 * What the service answered an erasure request with (security review, finding E, 2026-09-27).
 * A status as well as a body, because the caller treats them differently: 200 is a receipt to
 * verify, 410 is "erased, and the receipt has expired", any other 4xx is a refusal to back off
 * from, and a 5xx is the service asking to be tried again. A network failure still throws.
 */
export interface ErasureAnswer {
  /**
   * The HTTP status: 200 for a receipt, 410 for erased with the receipt expired, any other code a
   * refusal or a retry.
   */
  readonly status: number;
  /** The service's parsed JSON answer, or null. On a 200 it is the signed receipt, unverified. */
  readonly body: unknown;
}

/** What a token lets its holder do with one mailbox: deposit into it, or collect from it. */
export type MailboxRole = 'deposit' | 'collect';

/** What `createProvisioningClient` needs. `server` has no default. */
export interface ProvisioningOptions {
  /** The service's base URL, no trailing slash. Configuration, never a constant here. */
  readonly server: string;
  /** Injected so tests need no server and the app needs no polyfill. */
  readonly fetch?: typeof globalThis.fetch;
  /** Bounds every request. A phone on a Nepali carrier is not a fast server. */
  readonly timeoutMs?: number;
  /** The clock, in ms, that judges when a held token is nearly spent. Default `Date.now`. */
  readonly now?: () => number;
}

/** Which mailbox a token is for, and in which role. */
export interface MailboxTarget {
  /** Deposit into the mailbox, or collect from it. */
  readonly role: MailboxRole;
  /** Whose mailbox. For `collect` this is the caller's own identity. */
  readonly recipient: Uint8Array;
  /** Which of that recipient's mailboxes (ADR-16 §2: one per relationship by default). */
  readonly scope: MailboxScope;
  /**
   * A one-time pairing code a bridge offered (ADR-22 §4), for a deposit into its intake group
   * by someone it does not know yet. The service checks it against the bridge's signed record and
   * spends it; the code travels to the service once, and to nobody else.
   */
  readonly code?: string;
}

/**
 * The bytes the service expects a device to sign.
 *
 * Kept identical to `server/tokens.mjs`'s `challengeBytes` and written out here rather than
 * imported, because that file is plain Node that is never bundled — the two are one line and
 * the duplication is visible, where a build-time import from `server/` into `src/` would put
 * server code into a phone.
 */
const challengeBytes = (parts: {
  nonce: string;
  identityHex: string;
  database: string;
  role: MailboxRole;
}): Uint8Array =>
  utf8(
    `tapp-mailbox-challenge/v1\n${parts.nonce}\n${parts.identityHex}\n${parts.database}\n${parts.role}`,
  );

/** How a scope is named in a request body: a peer's key, or `g` and a group id. */
const scopeParam = (scope: MailboxScope): string =>
  scope.kind === 'group' ? `g${scope.groupId}` : bytesToHex(scope.peerKey);

/**
 * A token is good for five minutes; this stops using one a little before that.
 *
 * Thirty seconds of headroom rather than none, because the request the token is for has to
 * *finish* inside its life and a phone's clock is not the server's.
 */
const TOKEN_LIFE_MS = 300_000;
const TOKEN_HEADROOM_MS = 30_000;

/**
 * What signing a challenge needs, and nothing more.
 *
 * A `DeviceIdentity` satisfies it, and so does the pilot's telemetry key (ADR-12 §M1), which is
 * deliberately *not* a device identity: it has no `deviceId`, is not the patient's peer key, and
 * is used for the pilot mailbox and nothing else.
 */
export type SigningKey = Pick<DeviceIdentity, 'publicKey' | 'secretKey'>;

/** ADR-12 §M2: one database per enrolled device, named for its telemetry key. */
export const PILOT_MAILBOX_PREFIX = 'mbx-pilot-';

/**
 * The pilot mailbox's database name for one telemetry key: `PILOT_MAILBOX_PREFIX` and the key in
 * lowercase hex.
 */
export function pilotMailboxName(telemetryKey: Uint8Array): string {
  return `${PILOT_MAILBOX_PREFIX}${bytesToHex(telemetryKey)}`;
}

/** What `createProvisioningClient` returns. Each method is described where it is implemented. */
export interface ProvisioningClient {
  /** Puts this key on the pilot's deposit allowlist and creates its mailbox. */
  pilotConsent(key: SigningKey): Promise<void>;
  /**
   * Asks for erasure of what the pilot archive holds under `subject`; answers the status and the
   * receipt, unverified.
   */
  pilotErase(subject: Uint8Array, capability: Uint8Array): Promise<ErasureAnswer>;
  /**
   * Takes this key off the pilot allowlist, and the service purges what it still held undelivered.
   */
  pilotRevoke(key: SigningKey): Promise<void>;
  /** A deposit-only token source for this key's own pilot mailbox. */
  pilotTokenSource(key: SigningKey): TokenSource;
  /** One token for `target`, minted now. */
  token(identity: DeviceIdentity, target: MailboxTarget): Promise<string>;
  /** A token source for `target` that mints once and reuses the token until it is nearly spent. */
  tokenSource(identity: DeviceIdentity, target: MailboxTarget): TokenSource;
  /** Tells the service where this phone's poke goes, or that it goes nowhere (`null`). */
  registerPushToken(identity: SigningKey, token: string | null): Promise<void>;
  /** Asks the service to wake one recipient's phone; resolves to whether a poke was sent. */
  poke(identity: SigningKey, recipient: Uint8Array): Promise<boolean>;
  /** Removes collected frames from this identity's mailbox in `scope`, through the service. */
  purge(
    identity: DeviceIdentity,
    receipts: readonly MailboxReceipt[],
    scope: MailboxScope,
  ): Promise<void>;
}

/**
 * The client of the provisioning service at `options.server`. Each request is JSON, bounded by
 * `timeoutMs` (default 15 seconds), and a refusal throws `ProvisioningError`.
 */
export function createProvisioningClient(options: ProvisioningOptions): ProvisioningClient {
  const server = options.server.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const now = options.now ?? (() => Date.now());

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    return request('POST', path, body);
  }

  async function request(
    method: 'POST' | 'PUT',
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${server}${path}`, {
        method,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text !== '') {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      if (!response.ok) {
        const message =
          (parsed as { error?: unknown } | null)?.error ?? `the service refused ${path}`;
        // The service's own words, which are deliberately about the request and never about
        // who the caller is — and never the nonce or the signature (ADR-03 rule 8).
        throw new ProvisioningError(response.status, String(message), parsed);
      }
      return (parsed ?? {}) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Nonce, signature. One nonce is one signature: a replayed nonce is not a nonce. */
  async function sign(
    identity: SigningKey,
    database: string,
    role: MailboxRole,
  ): Promise<{ nonce: string; signature: string; identityHex: string }> {
    const identityHex = bytesToHex(identity.publicKey);
    const issued = await post('/challenge', { identity: identityHex, database, role });
    const nonce = issued.nonce;
    if (typeof nonce !== 'string' || nonce.length === 0) {
      throw new ProvisioningError(502, 'the service issued no challenge');
    }
    const signature = ed25519.sign(
      challengeBytes({ nonce, identityHex, database, role }),
      identity.secretKey,
    );
    return { nonce, signature: toBase64(signature), identityHex };
  }

  /**
   * The pilot's three requests (ADR-12 §M5), all signed over the device's own pilot mailbox.
   *
   * The service's `/token` path wants `recipient` present before it looks at `pilot`, so the
   * key is sent as both: a pilot mailbox is its depositor's own, and there is no other shape of
   * this request.
   */
  async function pilotRequest(
    key: SigningKey,
    path: '/pilot-consent' | '/pilot-revoke' | '/token',
    extra: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const database = pilotMailboxName(key.publicKey);
    const { nonce, signature, identityHex } = await sign(key, database, 'deposit');
    return post(path, {
      identity: identityHex,
      nonce,
      signature,
      role: 'deposit',
      recipient: identityHex,
      pilot: identityHex,
      ...extra,
    });
  }

  return {
    /**
     * Consent (ADR-12 §M5): the act that puts this key on the pilot's deposit allowlist and
     * creates its mailbox. A toggle that did not make this call would be a toggle that wrote
     * nothing, and the server would go on refusing every deposit.
     */
    async pilotConsent(key: SigningKey): Promise<void> {
      // The hash of the erasure capability goes with consent (ADR-17 §3, 2026-09-27), so that
      // the phone can still ask for erasure after revoke has made it forget this key.
      await pilotRequest(key, '/pilot-consent', {
        erasureCommit: capabilityCommitment(erasureCapability(key.secretKey)),
      });
    },

    /**
     * Erasure of what the pilot archive holds under one telemetry key, by the capability the
     * phone kept for it. Answers the signed receipt, unverified: the caller checks it against
     * the keys its build pins (`verifyHolderReceipt`).
     */
    async pilotErase(subject: Uint8Array, capability: Uint8Array): Promise<ErasureAnswer> {
      try {
        const body = await post('/pilot-erase', {
          subject: bytesToHex(subject),
          capability: bytesToHex(capability),
        });
        return { status: 200, body };
      } catch (error) {
        if (error instanceof ProvisioningError) return { status: error.status, body: error.body };
        throw error;
      }
    },

    /**
     * Revoke: takes the key off the allowlist, and the service purges whatever it was still
     * holding undelivered. After this the service issues this key no token at all.
     */
    async pilotRevoke(key: SigningKey): Promise<void> {
      await pilotRequest(key, '/pilot-revoke');
    },

    /**
     * A token source for this key's own pilot mailbox, deposit-only. There is no collect form:
     * nobody collects a pilot mailbox but the operator's collector, which does not come through here.
     */
    pilotTokenSource(key: SigningKey): TokenSource {
      let held: { token: string; until: number } | null = null;
      return async () => {
        if (held !== null && held.until > now()) return held.token;
        const minted = await pilotRequest(key, '/token');
        if (typeof minted.token !== 'string') {
          throw new ProvisioningError(502, 'the service minted no token');
        }
        held = { token: minted.token, until: now() + TOKEN_LIFE_MS - TOKEN_HEADROOM_MS };
        return minted.token;
      };
    },

    /** One token, minted now. The caller usually wants `tokenSource` instead. */
    async token(identity: DeviceIdentity, target: MailboxTarget): Promise<string> {
      const database = mailboxDatabaseName(target.recipient, target.scope);
      const { nonce, signature, identityHex } = await sign(identity, database, target.role);
      const minted = await post('/token', {
        identity: identityHex,
        nonce,
        signature,
        role: target.role,
        recipient: bytesToHex(target.recipient),
        scope: scopeParam(target.scope),
        ...(target.code === undefined ? {} : { code: target.code }),
      });
      if (typeof minted.token !== 'string') {
        throw new ProvisioningError(502, 'the service minted no token');
      }
      return minted.token;
    },

    /**
     * A `TokenSource` that mints once and reuses until the token is nearly spent.
     *
     * `CouchClient` calls its token source on every request, and a full challenge–sign–mint
     * round trip per request would triple the number of requests a sync makes — on a
     * connection where the whole point of the mailbox is that it may be slow and intermittent.
     */
    tokenSource(identity: DeviceIdentity, target: MailboxTarget): TokenSource {
      let held: { token: string; until: number } | null = null;
      return async () => {
        if (held !== null && held.until > now()) return held.token;
        const token = await this.token(identity, target);
        held = { token, until: now() + TOKEN_LIFE_MS - TOKEN_HEADROOM_MS };
        return token;
      };
    },

    /**
     * Tells the service where this phone's poke goes, or that it goes nowhere (`null`). PLAN
     * M11 F03b. Signed like a collect, over a purpose rather than a database, because it is the
     * recipient speaking about its own mail. The token is held by the service and never written
     * into the signed directory record, which depositors can read.
     */
    async registerPushToken(identity: SigningKey, token: string | null): Promise<void> {
      const identityHex = bytesToHex(identity.publicKey);
      const { nonce, signature } = await sign(identity, `push-${identityHex}`, 'collect');
      await request('PUT', '/push-token', { identity: identityHex, nonce, signature, token });
    },

    /**
     * Asks the service to wake one recipient's phone (F03b). Called after depositing an alert.
     * Resolves to whether a poke was actually sent: false when the recipient has no push
     * registered, which is not an error, because the mailbox still delivers on the floor's
     * schedule. A refusal (not on their allowlist, too many this hour) throws.
     */
    async poke(identity: SigningKey, recipient: Uint8Array): Promise<boolean> {
      const recipientHex = bytesToHex(recipient);
      const { nonce, signature, identityHex } = await sign(
        identity,
        `poke-${recipientHex}`,
        'deposit',
      );
      const answer = await post('/poke', {
        identity: identityHex,
        nonce,
        signature,
        recipient: recipientHex,
      });
      return answer.poked === true;
    },

    /**
     * Removes collected frames, through the service rather than through CouchDB.
     *
     * ADR-15 §Spike verification found that CouchDB 3.5.2 reserves `_purge` for **server**
     * admins, and a phone must never hold a server-admin credential — so the recipient proves
     * who it is with the same challenge signature it uses for a token, and the service does the
     * removing on its behalf. There is no form of this request that touches anyone else's mail:
     * the database name carries its owner, and the service checks it against the signature.
     */
    async purge(
      identity: DeviceIdentity,
      receipts: readonly MailboxReceipt[],
      scope: MailboxScope,
    ): Promise<void> {
      if (receipts.length === 0) return;
      const database = mailboxDatabaseName(identity.publicKey, scope);
      const { nonce, signature, identityHex } = await sign(identity, database, 'collect');
      await post('/purge', {
        identity: identityHex,
        nonce,
        signature,
        scope: scopeParam(scope),
        receipts: receipts.map((receipt) => ({ id: receipt.id, rev: receipt.rev })),
      });
    },
  };
}
