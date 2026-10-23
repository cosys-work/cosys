/**
 * Local-time helpers: a timestamp carrying the device's UTC offset, and the local calendar day.
 *
 * @module
 */

/**
 * ISO 8601 with the device's UTC offset, e.g. 2026-09-15T08:30:00.000+05:45.
 *
 * ADR-02 §3: clock skew is tolerated and the offset is kept, because a Nepal-time log
 * read on a phone that travelled must still show the time the patient experienced.
 */
export function isoWithOffset(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Local calendar day, YYYY-MM-DD. The finest granularity ADR-12 telemetry may use. */
export function localDay(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
