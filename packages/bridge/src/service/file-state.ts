/**
 * A bridge's state kept as one JSON file on its own volume, opened with {@link openFileState}.
 * @module
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { emptyStateData, stateOver, type BridgeState, type StateData } from '../state.ts';

/**
 * A bridge's state on its own volume (ADR-22 §2): one JSON file, rewritten whole after every
 * change, through a temporary file and a rename so a crash mid-write leaves the last good copy.
 *
 * One file is enough for what a bridge holds: which origins it wrote, who is paired, what waits
 * and what it offered. It is bookkeeping about patients and nothing of their record but the
 * deferred items, which wait at most thirty days (`loop.ts`). The volume is the operator's to
 * encrypt and back up, within the backup window its directory entry states.
 */
export async function openFileState(path: string): Promise<BridgeState> {
  let data: StateData;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as StateData;
    if (parsed.version !== 1)
      throw new Error(`a bridge state of version ${String(parsed.version)}`);
    data = { ...emptyStateData(), ...parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    data = emptyStateData();
  }
  await mkdir(dirname(path), { recursive: true });
  let writing = Promise.resolve();
  return stateOver(data, (current) => {
    // Writes are queued, so two changes in flight cannot interleave their renames.
    writing = writing.then(async () => {
      const temporary = `${path}.writing`;
      await writeFile(temporary, JSON.stringify(current), { mode: 0o600 });
      await rename(temporary, path);
    });
    return writing;
  });
}
