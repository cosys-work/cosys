/**
 * Registers the `bridge:` kinds (ADR-22 §3; PLAN M19-2). Importing this module is how a process
 * says it holds bridged rows: the bridge itself (`@cosys/bridge`), and TApp once its landing rule
 * checks them (ADR-22 §3, `docs/cat-pub/progress.md` Owed). Reading the shapes (`bridge.ts`)
 * does not register anything.
 *
 * Registered under their own modality, `bridge`, rather than as the substrate's: the registry's
 * substrate kinds are loaded by every app, and an app that has not decided to accept a bridge's
 * rows must not start accepting them because it upgraded `@cosys/record`.
 *
 * @module
 */

import { BRIDGE_KIND_SPECS, BRIDGE_MODALITY } from './bridge.ts';
import { registerKinds } from './kinds.ts';

registerKinds(BRIDGE_MODALITY, BRIDGE_KIND_SPECS);
