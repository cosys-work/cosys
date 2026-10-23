import { bytesToHex, hmacSha256, utf8 } from './deps.ts';

/**
 * The relay's access token, the phone's half (ADR-15 §9 step 3, amended 2026-09-27).
 *
 * The founder's rule: *"Only the app itself can use the relay(s). Don't maintain ids of
 * registered installs."* So nothing is registered and nobody is asked. The endpoint presents a
 * token derived from a **release key** compiled into the build and from its own endpoint id, and
 * the relay (`packages/peer-relay`) recomputes it from the keys it was configured with:
 *
 *     token = "v1." kid "." hex(HMAC-SHA256(key, "tapp-relay-access/v1\n" endpointId "\n" kid))
 *
 * The relay's own handshake has already proved the endpoint holds the secret for that id, so a
 * token copied off one phone admits nobody else. What the token cannot prove is that the caller
 * is the app: the key is in the APK and can be taken out of it. The ADR says so plainly, and the
 * remedy it names is retiring a `kid`, which costs installs on that release their direct path
 * and nothing else, because the mailbox still delivers.
 *
 * `packages/peer-relay/src/access.rs` implements the same derivation; both test the same vector.
 */

/** The only token version there is. A change to the derivation is a new version. */
export const RELAY_ACCESS_VERSION = 'v1';

/** The query parameter the Rust crate splits the token off the relay URL by. */
export const RELAY_TOKEN_PARAM = 'relay_token';

const KID = /^[a-z0-9-]{1,16}$/;
const ENDPOINT_ID = /^[0-9a-f]{64}$/;

/** One release key: its name and its 32 bytes. */
export interface RelayAccessKey {
  /** The key's name, 1 to 16 of `a-z`, `0-9` and `-`; it is carried in the token. */
  readonly kid: string;
  /** The 32-byte HMAC-SHA256 key. Secret. */
  readonly key: Uint8Array;
}

/**
 * Reads `kid=<64 hex>` into a key, or null for anything else, including the empty string a
 * build with no key carries. Null means "present nothing", which a relay admitting everyone
 * accepts and a gated one refuses; either way the mailbox is untouched.
 */
export function parseRelayAccessKey(entry: string | null | undefined): RelayAccessKey | null {
  if (typeof entry !== 'string') return null;
  const at = entry.indexOf('=');
  if (at <= 0) return null;
  const kid = entry.slice(0, at).trim();
  const hex = entry
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!KID.test(kid) || !/^[0-9a-f]{64}$/.test(hex)) return null;
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return { kid, key };
}

/** The token one endpoint presents. Throws on an id or key that is not one: a caller bug. */
export function relayAccessToken(access: RelayAccessKey, endpointId: string): string {
  if (!KID.test(access.kid)) throw new Error('a release key name is 1 to 16 of a-z, 0-9 and -');
  if (access.key.length !== 32) throw new Error('a release key is 32 bytes');
  if (!ENDPOINT_ID.test(endpointId)) throw new Error('an endpoint id is 64 lowercase hex');
  const mac = hmacSha256(access.key, utf8(`tapp-relay-access/v1\n${endpointId}\n${access.kid}`));
  return `${RELAY_ACCESS_VERSION}.${access.kid}.${bytesToHex(mac)}`;
}

/**
 * The relay URL with the token on it, which is how it crosses the FFI without changing the
 * binding's signature. The crate takes it off again before dialling and sends it as an
 * `Authorization: Bearer` header (`relay_access` in `packages/peer-iroh/rust/src/lib.rs`), so
 * the URL the relay sees never carries it.
 *
 * String work rather than `URL`, because React Native's `URL` has no `searchParams`.
 */
export function withRelayAccess(relayUrl: string, token: string | null): string {
  if (token === null || token === '') return relayUrl;
  const hash = relayUrl.indexOf('#');
  const base = hash === -1 ? relayUrl : relayUrl.slice(0, hash);
  const separator = base.includes('?')
    ? base.endsWith('?') || base.endsWith('&')
      ? ''
      : '&'
    : '?';
  return `${base}${separator}${RELAY_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}
