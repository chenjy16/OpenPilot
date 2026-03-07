/**
 * Memory Tools
 *
 * Persistent context memory for the Agent.
 * OpenPilot equivalent: memory_search / memory_get tools.
 *
 * Two memory layers:
 *   1. USER.md — long-term user preferences and facts (file-based)
 *   2. Session search — full-text search across past session messages (SQLite FTS5)
 *
 * Tools:
 *   - memorySearch: Search past conversations using FTS5
 *   - memoryGet: Read the USER.md long-term memory file
 *   - memoryUpdate: Append or replace content in USER.md
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

// ---------------------------------------------------------------------------
// USER.md paths (same priority as promptBuilder)
// ---------------------------------------------------------------------------

const WORKSPACE_USER_MD = path.resolve('.openpilot', 'USER.md');
const USER_LEVEL_USER_MD = path.join(os.homedir(), '.openpilot', 'USER.md');
const BUNDLED_USER_MD = path.resolve(__dirname, '..', 'runtime', 'prompts', 'USER.md');

async function resolveUserMdPath(): Promise<string> {
  for (const p of [WORKSPACE_USER_MD, USER_LEVEL_USER_MD, BUNDLED_USER_MD]) {
    try {
      await fs.access(p);
      return p;
    } catch { /* continue */ }
  }
  // Default to workspace level for creation
  return WORKSPACE_USER_MD;
}

// ---------------------------------------------------------------------------
// FTS5 initialization (lazy, per-database)
// ---------------------------------------------------------------------------

let ftsInitialized = false;

/** Reset FTS state (for testing) */
export function resetFTSState(): void {
  ftsInitialized = false;
}

function ensureFTS(db: Database.Database): void {
  if (ftsInitialized) return;
  try {
    // Create FTS5 virtual table if it doesn't exist.
    // Uses external content mode — the FTS index is separate from the messages table.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        session_id UNINDEXED,
        role UNINDEXED,
        timestamp UNINDEXED
      );
    `);

    // Populate FTS index from existing messages (if empty)
    const count = db.prepare('SELECT COUNT(*) as c FROM messages_fts').get() as any;
    if (count.c === 0) {
      db.exec(`
        INSERT INTO messages_fts(content, session_id, role, timestamp)
        SELECT content, session_id, role, timestamp FROM messages;
      `);
    }

    ftsInitialized = true;
  } catch {
    // FTS5 may not be available in all SQLite builds — degrade gracefully
    ftsInitialized = true;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * Create memory tools that use the given database for FTS search.
 */
export function createMemoryTools(db: Database.Database): {
  memorySearchTool: Tool;
  memoryGetTool: Tool;
  memoryUpdateTool: Tool;
} {
  const memorySearchTool: Tool = {
    name: 'memorySearch',
    description:
      'Search past conversation messages using full-text search. ' +
      'Returns matching messages with session ID, role, and timestamp.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports FTS5 syntax: AND, OR, NOT, "phrase")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10, max: 50)',
        },
      },
      required: ['query'],
    },
    execute: async (params: Record<string, unknown>) => {
      const query = params.query as string;
      const limit = Math.min(Math.max((params.limit as number) ?? 10, 1), 50);

      if (!query || query.trim() === '') {
        throw new Error('Search query must be non-empty');
      }

      ensureFTS(db);

      try {
        // Try FTS5 search first
        const rows = db.prepare(`
          SELECT content, session_id, role, timestamp,
                 rank
          FROM messages_fts
          WHERE messages_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(query, limit) as any[];

        return {
          query,
          count: rows.length,
          results: rows.map(r => ({
            content: r.content.length > 500 ? r.content.slice(0, 500) + '...' : r.content,
            sessionId: r.session_id,
            role: r.role,
            timestamp: r.timestamp,
          })),
        };
      } catch {
        // FTS5 not available — fall back to LIKE search
        const rows = db.prepare(`
          SELECT content, session_id, role, timestamp
          FROM messages
          WHERE content LIKE ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).all(`%${query}%`, limit) as any[];

        return {
          query,
          count: rows.length,
          fallback: true,
          results: rows.map(r => ({
            content: r.content.length > 500 ? r.content.slice(0, 500) + '...' : r.content,
            sessionId: r.session_id,
            role: r.role,
            timestamp: r.timestamp,
          })),
        };
      }
    },
  };

  const memoryGetTool: Tool = {
    name: 'memoryGet',
    description:
      'Read the USER.md long-term memory file. Contains user preferences, facts, and notes ' +
      'that persist across sessions.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const mdPath = await resolveUserMdPath();
      try {
        const content = await fs.readFile(mdPath, 'utf-8');
        return { path: mdPath, content };
      } catch {
        return { path: mdPath, content: '', note: 'USER.md does not exist yet. Use memoryUpdate to create it.' };
      }
    },
  };

  const memoryUpdateTool: Tool = {
    name: 'memoryUpdate',
    description:
      'Update the USER.md long-term memory file. Use mode "append" to add new information, ' +
      'or "replace" to overwrite the entire file.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to write or append',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'Write mode: "append" adds to end, "replace" overwrites (default: append)',
        },
      },
      required: ['content'],
    },
    execute: async (params: Record<string, unknown>) => {
      const content = params.content as string;
      const mode = (params.mode as string) ?? 'append';

      const mdPath = await resolveUserMdPath();

      // Ensure directory exists
      await fs.mkdir(path.dirname(mdPath), { recursive: true });

      if (mode === 'replace') {
        await fs.writeFile(mdPath, content, 'utf-8');
        return { action: 'replaced', path: mdPath, length: content.length };
      }

      // Append mode
      let existing = '';
      try {
        existing = await fs.readFile(mdPath, 'utf-8');
      } catch { /* file doesn't exist yet */ }

      const separator = existing.endsWith('\n') || existing === '' ? '' : '\n';
      const newContent = existing + separator + content + '\n';
      await fs.writeFile(mdPath, newContent, 'utf-8');

      return { action: 'appended', path: mdPath, addedLength: content.length };
    },
  };

  return { memorySearchTool, memoryGetTool, memoryUpdateTool };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMemoryTools(executor: ToolExecutor, db: Database.Database): void {
  const { memorySearchTool, memoryGetTool, memoryUpdateTool } = createMemoryTools(db);
  executor.register(memorySearchTool);
  executor.register(memoryGetTool);
  executor.register(memoryUpdateTool);
}
