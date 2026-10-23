/**
 * The logger's types: levels, the shape of a record and of a field, the sink a record is
 * written to, and the codes every catalogue declares.
 *
 * ADR-12 §Diagnostic logging. Distinct from `usage_events` (pilot counters, ADR-02) and
 * from the deferred telemetry batch (Milestone 5). Nothing here is transmitted.
 *
 * @module
 */

/** The four levels, lowest first. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** One of {@link LOG_LEVELS}. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Ordering, so a console threshold is a comparison rather than a set membership test. */
export const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * What a field may hold. Primitives only — an object field would be the free-form escape
 * hatch ADR-12 exists to prevent, and `undefined` is dropped rather than stored as null
 * so an optional field simply does not appear.
 */
export type LogValue = string | number | boolean | null;

/** A record's fields: names to primitive values. */
export type LogFieldsShape = Readonly<Record<string, LogValue>>;

/** One row of `app_log`. */
export interface LogRecord {
  /** A ULID taken at the record's own time, so ids sort in the order records were made. */
  readonly id: string;
  /** ISO 8601 with offset, like every other timestamp in the app (ADR-02 §3). */
  readonly at: string;
  /** How severe it is. */
  readonly level: LogLevel;
  /** The catalogue code, such as `crash.fatal`. */
  readonly code: string;
  /** JSON object, already serialised — the column type. */
  readonly fields: string;
  /** The device that wrote it, or `unknown` before the logger is told. */
  readonly deviceId: string;
}

/**
 * Where flushed records go. Implemented by `src/data/repo/app-log.ts`; the logger never
 * imports the database, which is what lets the whole module be exercised in Vitest and
 * what lets it keep working while the database is down.
 */
export interface LogSink {
  /** Stores a batch. A rejection puts the batch back at the front of the logger's queue. */
  write(records: readonly LogRecord[]): Promise<void>;
}

/** Every error is logged as a name plus a trimmed stack, never the thrown value (ADR-12). */
export interface ErrorFields {
  /** The error's `name`, or the thrown value's `typeof` when it was not an `Error`. */
  readonly errorName: string;
  /** Frame lines only; the `Error: <message>` line is stripped before this is built. */
  readonly stack: string;
}

/**
 * A code catalogue: every code an app may log, each with its declared fields. The catalogue
 * is the app's (TApp's is `apps/tapp/src/lib/log/codes.ts`); the logger is shared, so the
 * clinic's catalogue and its `clinic_log` sink are a second catalogue and a second sink, not a
 * second logger (PLAN M12-B2).
 */
export type LogCatalogue = { readonly [code: string]: object };

/** The codes the logger and the crash hooks write themselves, which every catalogue declares. */
export interface CoreLogFields {
  /** Records lost to a full buffer since the last flush, written where the gap is. */
  'log.dropped': { readonly count: number };
  /**
   * The sink rejected a batch. Printed to the console in every build rather than recorded,
   * since the sink is what failed; the batch is kept and retried on the next flush.
   */
  'log.sink.failed': ErrorFields;
  /** An error reached React Native's global handler as fatal. */
  'crash.fatal': ErrorFields;
  /** An error reached React Native's global handler as not fatal. */
  'crash.nonfatal': ErrorFields;
  /** A promise was rejected and nothing handled it. */
  'crash.unhandledRejection': ErrorFields;
}
