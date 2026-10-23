/**
 * The entropy source where the runtime has Web Crypto: Node (every test) and the clinic app's
 * webview (ADR-20 §14). React Native has none, and Metro picks `entropy.native.ts` instead by
 * its platform-extension rule, which reads the OS CSPRNG through `expo-crypto` (ADR-03). The
 * two files export the same three names, so nothing above this seam knows which it got.
 *
 * Split out of `src/lib/random.ts` when `src/lib/crypto` became `@cosys/crypto` (PLAN M12-B2):
 * the clinic app cannot import an Expo module, and TApp's bundle reads the same source it
 * always did.
 *
 * @module
 */

function webCrypto(): Crypto {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto === undefined || typeof crypto.getRandomValues !== 'function') {
    // Never `Math.random` (ADR-03): no entropy is a failure, not a fallback.
    throw new Error('No Web Crypto in this runtime; @cosys/crypto has no fallback entropy source');
  }
  return crypto;
}

/** Cryptographically secure random bytes from the runtime's Web Crypto. */
export function randomBytes(byteCount: number): Uint8Array {
  // getRandomValues fills at most 65,536 bytes a call.
  const out = new Uint8Array(byteCount);
  for (let offset = 0; offset < byteCount; offset += 65_536) {
    webCrypto().getRandomValues(out.subarray(offset, Math.min(byteCount, offset + 65_536)));
  }
  return out;
}

/**
 * Nothing to install: `@noble` reads `globalThis.crypto.getRandomValues`, which this runtime
 * already has. Kept so both variants export the same surface (`entropy.native.ts` installs
 * one on Hermes, which has none).
 */
export function installGlobalRandom(): void {
  webCrypto();
}
