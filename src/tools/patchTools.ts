/**
 * Code Patch Tool
 *
 * Applies unified diff patches to files.
 * OpenPilot equivalent: apply_patch tool.
 *
 * Accepts a unified diff string and applies it to the target file.
 * Supports both creating new files and modifying existing ones.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

/**
 * Parse a unified diff and extract hunks.
 */
interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

interface ParsedDiff {
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
}

function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n');
  let oldFile = '';
  let newFile = '';
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      oldFile = line.slice(4).replace(/^[ab]\//, '').trim();
    } else if (line.startsWith('+++ ')) {
      newFile = line.slice(4).replace(/^[ab]\//, '').trim();
    } else if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldCount: parseInt(match[2] ?? '1', 10),
          newStart: parseInt(match[3], 10),
          newCount: parseInt(match[4] ?? '1', 10),
          lines: [],
        };
        hunks.push(currentHunk);
      }
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.lines.push(line);
    }
  }

  return { oldFile, newFile, hunks };
}

/**
 * Apply parsed diff hunks to file content.
 */
function applyHunks(originalContent: string, hunks: DiffHunk[]): string {
  const originalLines = originalContent.split('\n');
  const result: string[] = [];
  let originalIdx = 0; // 0-based index into originalLines

  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart - 1; // Convert to 0-based

    // Copy lines before this hunk
    while (originalIdx < hunkStart && originalIdx < originalLines.length) {
      result.push(originalLines[originalIdx]);
      originalIdx++;
    }

    // Apply hunk lines
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        // Add new line
        result.push(line.slice(1));
      } else if (line.startsWith('-')) {
        // Remove old line — skip it
        originalIdx++;
      } else if (line.startsWith(' ')) {
        // Context line — copy through
        result.push(line.slice(1));
        originalIdx++;
      }
    }
  }

  // Copy remaining lines after last hunk
  while (originalIdx < originalLines.length) {
    result.push(originalLines[originalIdx]);
    originalIdx++;
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const applyPatchTool: Tool = {
  name: 'applyPatch',
  description:
    'Apply a unified diff patch to a file. Supports creating new files and modifying existing ones. ' +
    'The patch should be in standard unified diff format (output of `diff -u` or `git diff`).',
  parameters: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'The unified diff patch content',
      },
      basePath: {
        type: 'string',
        description: 'Base directory to resolve file paths against (default: current directory)',
      },
    },
    required: ['patch'],
  },
  execute: async (params: Record<string, unknown>) => {
    const patchText = params.patch as string;
    const basePath = (params.basePath as string) ?? process.cwd();

    if (!patchText || patchText.trim() === '') {
      throw new Error('Patch content is empty');
    }

    const parsed = parseDiff(patchText);

    if (!parsed.newFile && !parsed.oldFile) {
      throw new Error('Could not parse file paths from diff. Ensure the patch has --- and +++ headers.');
    }

    const targetFile = parsed.newFile || parsed.oldFile;
    const targetPath = path.resolve(basePath, targetFile);

    // Security: prevent path traversal
    const resolvedBase = path.resolve(basePath);
    if (!targetPath.startsWith(resolvedBase)) {
      throw new Error(`Path traversal detected: ${targetFile} resolves outside base directory`);
    }

    if (parsed.oldFile === '/dev/null' || parsed.hunks.length === 0) {
      // New file creation — collect all '+' lines
      const newContent = parsed.hunks
        .flatMap(h => h.lines.filter(l => l.startsWith('+')).map(l => l.slice(1)))
        .join('\n');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, newContent, 'utf-8');
      return { action: 'created', file: targetFile, lines: newContent.split('\n').length };
    }

    // Modify existing file
    let originalContent: string;
    try {
      originalContent = await fs.readFile(targetPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`File not found: ${targetFile}. Use /dev/null as old file to create a new file.`);
      }
      throw err;
    }

    const patched = applyHunks(originalContent, parsed.hunks);
    await fs.writeFile(targetPath, patched, 'utf-8');

    const addedLines = parsed.hunks.reduce(
      (sum, h) => sum + h.lines.filter(l => l.startsWith('+')).length, 0,
    );
    const removedLines = parsed.hunks.reduce(
      (sum, h) => sum + h.lines.filter(l => l.startsWith('-')).length, 0,
    );

    return {
      action: 'patched',
      file: targetFile,
      hunks: parsed.hunks.length,
      added: addedLines,
      removed: removedLines,
    };
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPatchTools(executor: ToolExecutor): void {
  executor.register(applyPatchTool);
}

// Export for testing
export { parseDiff, applyHunks };
