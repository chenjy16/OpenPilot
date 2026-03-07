/**
 * Prompt File Watcher
 *
 * Watches prompt markdown files and skill directories for changes.
 * When a change is detected, calls the invalidation callback (debounced).
 */

import fs from 'fs';
import path from 'path';

const PROMPT_DIR = path.resolve(__dirname, 'prompts');
const SKILLS_DIR = path.resolve(__dirname, 'skills');
const DEBOUNCE_MS = 1000;

/**
 * Watch prompt and skill files for changes.
 * Calls `onInvalidate` (debounced) when any watched file changes.
 */
export function watchPromptFiles(onInvalidate: () => void): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const debouncedInvalidate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onInvalidate();
    }, DEBOUNCE_MS);
  };

  const watchDir = (dir: string) => {
    try {
      if (!fs.existsSync(dir)) return;
      fs.watch(dir, { recursive: true }, (_event, _filename) => {
        debouncedInvalidate();
      });
    } catch {
      // fs.watch may not be supported on all platforms — fail silently
    }
  };

  watchDir(PROMPT_DIR);
  watchDir(SKILLS_DIR);
}
