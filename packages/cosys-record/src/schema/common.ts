/**
 * Zod primitives the substrate's schemas share: an ISO timestamp with an offset, an ISO date, and
 * a reference to another row.
 *
 * @module
 */

import { z } from 'zod';

/** ISO 8601 timestamp with an offset, e.g. 2026-09-15T08:30:00+05:45. */
export const isoTimestamp: z.ZodISODateTime = z.iso.datetime({ offset: true });

/** ISO 8601 calendar date, e.g. 2026-09-15. */
export const isoDate: z.ZodISODate = z.iso.date();

/** A ULID reference to another row. */
export const ulidRef: z.ZodString = z.string().length(26);
