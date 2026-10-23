/**
 * Crash capture: {@link installCrashHandlers} routes uncaught errors and unhandled rejections
 * into a {@link Logger}.
 *
 * ADR-12: "Crash capture hooks RN's global error handler and unhandled rejections
 * through the same typed API." Same API means the same three fields reach `app_log`: a
 * crash is not a licence to log a thrown value.
 *
 * Both hooks are optional at runtime. `ErrorUtils` is a React Native global that does not
 * exist in Node, and `unhandledrejection` is a DOM-style event Hermes provides and Node
 * does not; each is installed only where it exists, and the previous handler is always
 * called so this never swallows a crash the platform was going to report.
 *
 * @module
 */

import { errorFields, type Logger } from './logger.ts';
import type { CoreLogFields } from './types.ts';

type FatalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler?: () => FatalHandler | undefined;
  setGlobalHandler: (handler: FatalHandler) => void;
}

interface RejectionEvent {
  readonly reason?: unknown;
}

function errorUtils(): ErrorUtilsLike | null {
  const candidate = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  return candidate && typeof candidate.setGlobalHandler === 'function' ? candidate : null;
}

/**
 * Installs both hooks. Returns a function that removes them again — used by tests, and by
 * anything that needs a clean teardown; production installs once at startup and never
 * uninstalls.
 */
export function installCrashHandlers<F extends CoreLogFields>(logger: Logger<F>): () => void {
  const undo: (() => void)[] = [];

  const hooks = errorUtils();
  if (hooks) {
    const previous = hooks.getGlobalHandler?.();
    const handler: FatalHandler = (error, isFatal) => {
      logger.error(isFatal === false ? 'crash.nonfatal' : 'crash.fatal', errorFields(error));
      // Flush before the platform tears the process down. Not awaited — there is nothing
      // to await it from — but it gets the batch to the sink on the current tick.
      void logger.flush();
      previous?.(error, isFatal);
    };
    hooks.setGlobalHandler(handler);
    undo.push(() => {
      if (previous) hooks.setGlobalHandler(previous);
    });
  }

  const target = globalThis as {
    addEventListener?: (event: string, listener: (event: RejectionEvent) => void) => void;
    removeEventListener?: (event: string, listener: (event: RejectionEvent) => void) => void;
  };
  if (typeof target.addEventListener === 'function') {
    const listener = (event: RejectionEvent) => {
      logger.error('crash.unhandledRejection', errorFields(event?.reason));
    };
    target.addEventListener('unhandledrejection', listener);
    undo.push(() => target.removeEventListener?.('unhandledrejection', listener));
  }

  return () => {
    for (const remove of undo.reverse()) remove();
  };
}
