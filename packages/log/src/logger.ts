/**
 * The typed logger: a {@link Logger} over an app's code catalogue, writing through a
 * {@link LogSink} it is given.
 *
 * ADR-12 §Writing. The queue is the whole design:
 *
 * - **A log call is never awaited and never blocks.** It appends to an array and returns.
 *   Logging must not contend with the UI thread or with a save.
 * - **The oldest are dropped when the buffer is full**, and the drop is itself logged, so
 *   a gap in the log reads as a gap rather than as silence.
 * - **Records made before the database opens buffer in memory** and flush once it is up.
 *   Without this, a failure in connection setup or in the migration runner is invisible —
 *   which is exactly how the op-sqlite v18 driver bug stayed hidden while behaving
 *   wrongly on every launch (ADR-02).
 *
 * Build parity (ADR-12): there is no `__DEV__` branch anywhere below. Every build
 * records the same rows. `consoleLevel` is the one thing a build may vary, and it changes
 * only what is printed.
 *
 * @module
 */

import { ulid } from '@cosys/crypto/ulid';
import { isoWithOffset } from '@cosys/record/time';
import {
  LEVEL_ORDER,
  type CoreLogFields,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LogValue,
} from './types.ts';

/** Records held in memory before a flush. Roughly a minute of a chatty startup. */
const MAX_BUFFER = 500;

/** Rows written per sink call. */
const BATCH_SIZE = 50;

/** How long a record may sit in the queue before the batch goes out. */
const FLUSH_INTERVAL_MS = 2000;

/** A field string longer than this is truncated; nothing legitimate is this long. */
const MAX_FIELD_LENGTH = 200;

/** How a {@link Logger} is set up. Every option has a default. */
export interface LoggerOptions {
  /** Below this level nothing is printed. Rows are written regardless (ADR-12). */
  readonly consoleLevel?: LogLevel | 'silent';
  /** Written into every record. Default `unknown`, until {@link Logger.configure} sets it. */
  readonly deviceId?: string;
  /** The clock records are stamped with. Default the system clock. */
  readonly now?: () => Date;
  /** Injected in tests; production uses the global. */
  readonly schedule?: (callback: () => void, ms: number) => unknown;
  /** Cancels what `schedule` returned. Injected in tests; production uses the global. */
  readonly cancel?: (handle: unknown) => void;
  /** Where printed lines go. Default the global `console`. */
  readonly console?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

/** Primitives only, truncated, `undefined` dropped. */
function normaliseFields(fields: Readonly<Record<string, unknown>>): string {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === 'string') out[key] = value.slice(0, MAX_FIELD_LENGTH);
    else if (typeof value === 'number') out[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === 'boolean' || value === null) out[key] = value;
    // Anything else is a programming error the types already rule out; drop it rather
    // than serialise an object into a log line.
  }
  return JSON.stringify(out);
}

/**
 * Typed by the app's code catalogue `F`, which has to declare the logger's own codes
 * (`CoreLogFields`). TApp's `log` is a `Logger<LogFields>`.
 */
export class Logger<F extends CoreLogFields = CoreLogFields> {
  private queue: LogRecord[] = [];
  private sink: LogSink | null = null;
  private timer: unknown = null;
  private flushing = false;
  private dropped = 0;
  private deviceId = 'unknown';
  private consoleLevel: LogLevel | 'silent' = 'warn';
  private readonly now: () => Date;
  private readonly schedule: (callback: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly out: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

  /** Makes a logger with no sink: records buffer in memory until {@link attachSink}. */
  constructor(options: LoggerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
    this.cancel =
      options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.out = options.console ?? console;
    this.configure(options);
  }

  /** Changes the console threshold or the device id; an option left out is kept. */
  configure(options: Pick<LoggerOptions, 'consoleLevel' | 'deviceId'>): void {
    if (options.consoleLevel !== undefined) this.consoleLevel = options.consoleLevel;
    if (options.deviceId !== undefined) this.deviceId = options.deviceId;
  }

  /** Attaches the database sink and flushes everything buffered since startup. */
  attachSink(sink: LogSink): void {
    this.sink = sink;
    void this.flush();
  }

  /** Detaches the sink — used by `purge`, which closes and reopens the database. */
  detachSink(): void {
    this.sink = null;
  }

  /** Records `code` at debug level, with the fields its catalogue entry declares. Never blocks. */
  debug<C extends keyof F & string>(code: C, fields?: F[C]): void {
    this.record('debug', code, fields);
  }
  /** Records `code` at info level. Never blocks. */
  info<C extends keyof F & string>(code: C, fields?: F[C]): void {
    this.record('info', code, fields);
  }
  /** Records `code` at warn level. Never blocks. */
  warn<C extends keyof F & string>(code: C, fields?: F[C]): void {
    this.record('warn', code, fields);
  }
  /** Records `code` at error level. Never blocks. */
  error<C extends keyof F & string>(code: C, fields?: F[C]): void {
    this.record('error', code, fields);
  }

  /** Builds the row: a ULID, the time with its offset, and the fields normalised. */
  private makeRecord(level: LogLevel, code: string, fields: unknown): LogRecord {
    const at = this.now();
    return {
      id: ulid(at.getTime()),
      at: isoWithOffset(at),
      level,
      code,
      fields: normaliseFields((fields ?? {}) as Record<string, unknown>),
      deviceId: this.deviceId,
    };
  }

  /** Queues a record, dropping the oldest when the buffer is full, and prints it. */
  private record(level: LogLevel, code: string, fields: unknown): void {
    const entry = this.makeRecord(level, code, fields);
    if (this.queue.length >= MAX_BUFFER) {
      this.queue.shift();
      this.dropped += 1;
    }
    this.queue.push(entry);
    this.print(entry);
    this.scheduleFlush();
  }

  /** Prints a record when its level is at or above the console threshold. */
  private print(entry: LogRecord): void {
    if (this.consoleLevel === 'silent') return;
    if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[this.consoleLevel]) return;
    const line = `[${entry.level}] ${entry.code} ${entry.fields}`;
    this.out[entry.level](line);
  }

  /** Starts the flush timer, unless one is running or there is no sink yet. */
  private scheduleFlush(): void {
    if (this.timer !== null || this.sink === null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Writes one batch. Failure is not retried in place — the records go back to the front
   * of the queue and the next flush picks them up, so a transient database error does not
   * turn into a busy loop against a database that is already unhappy.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.sink === null || this.queue.length === 0) return;
    this.flushing = true;
    try {
      if (this.dropped > 0) {
        // Unshifted, not appended: the notice belongs where the gap is, at the head of
        // the surviving records, so reading the log top to bottom reads the gap in place.
        const notice = this.makeRecord('warn', 'log.dropped', { count: this.dropped });
        this.dropped = 0;
        this.queue.unshift(notice);
        this.print(notice);
      }
      const batch = this.queue.splice(0, BATCH_SIZE);
      try {
        await this.sink.write(batch);
      } catch (error) {
        this.queue.unshift(...batch.slice(-MAX_BUFFER));
        this.printSinkFailure(error);
        return;
      }
    } finally {
      this.flushing = false;
    }
    if (this.queue.length > 0) this.scheduleFlush();
  }

  /**
   * A sink failure cannot be logged through the sink. It is printed unconditionally: if
   * diagnostics are not reaching storage, that is the one thing worth saying out loud in
   * every build.
   */
  private printSinkFailure(error: unknown): void {
    this.out.error(`[error] log.sink.failed ${JSON.stringify(errorFields(error))}`);
  }

  /** What the Settings viewer shows when the database never opened (ADR-12 §Bootstrap). */
  buffered(): readonly LogRecord[] {
    return [...this.queue];
  }

  /** Stops the pending timer. Tests and teardown only. */
  stop(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }
}

/**
 * ADR-12: "Error objects are logged as name plus trimmed stack, never by interpolating a
 * thrown value into a message." The message line is dropped on purpose — a thrown error
 * in this app can carry a row id, a file path, or a value read off a form.
 */
export function errorFields(error: unknown): { errorName: string; stack: string } {
  if (!(error instanceof Error)) {
    return { errorName: typeof error, stack: '' };
  }
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, 8)
    .map((line) => line.trim())
    .join(' | ');
  return { errorName: error.name, stack: frames.slice(0, MAX_FIELD_LENGTH) };
}

/** Longest runtime reason kept: enough for a native library's sentence, not for a prompt. */
const MAX_REASON_LENGTH = 160;

/**
 * The reason a Tier 1 runtime gave for failing, with anything it quoted removed (founder,
 * 2026-09-28; ADR-12 §Redaction, amended the same day).
 *
 * **The one exception to "name plus trimmed stack", and why it is narrow.** A model runtime's
 * native error arrives with an empty JS stack, so name and stack say nothing: a question that
 * failed on the Galaxy M16 left `{"errorName":"Error","stack":""}` and no way to tell a grammar
 * dead end from a busy context. Its message is the only diagnosis there is. It is also free
 * text the app does not control, and a runtime can echo what it was given, which here is the
 * patient's sentence and figures from their record. So:
 *
 * - only `tier1.engine.failed` carries it, never a general error helper;
 * - anything inside quotes (straight, curly or backticks) is replaced by `"…"`, which is where
 *   echoed input sits in the messages these runtimes produce;
 * - it is cut at 160 characters, so a runtime that echoes a whole prompt unquoted still does
 *   not put it in the log.
 *
 * What remains possible is a runtime echoing a short unquoted fragment of the input. That is
 * the residual risk the founder accepted in exchange for a failure that says why.
 */
export function redactRuntimeReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return raw
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, '"…"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REASON_LENGTH);
}

/** `errorFields` plus the redacted runtime reason, for `tier1.engine.failed` only. */
export function runtimeErrorFields(error: unknown): {
  errorName: string;
  stack: string;
  runtimeReason: string;
} {
  return { ...errorFields(error), runtimeReason: redactRuntimeReason(error) };
}
