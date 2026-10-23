/**
 * A QR code encoder with no dependencies: byte mode at error-correction level M, versions 1
 * to 20. {@link encodeQr} returns the module matrix; drawing it is the caller's.
 *
 * ```ts
 * import { encodeQr } from '@cosys/qr';
 *
 * const symbol = encodeQr('https://example.org');
 * // symbol.modules[row][col] is true where the module is dark.
 * ```
 *
 * @module
 */
export { encodeQr, penalty, QrTooLongError, type QrOptions, type QrSymbol } from './encode.ts';
export { MAX_VERSION, MIN_VERSION, sizeOf } from './versions.ts';
