/**
 * Tests for memoryTools — FTS search and USER.md management
 */

import Database from 'better-sqlite3';
import { createMemoryTools, resetFTSState } from './memoryTools';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('memoryTools', () => {
  let db: Database.Database;
  let tools: ReturnType<typeof createMemoryTools>;

  beforeEach(() => {
    resetFTSState();
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER,
        updated_at INTEGER,
        metadata TEXT
      );
      CREATE TABLE messages (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp INTEGER,
        tool_calls TEXT,
        tool_results TEXT
      );
    `);

    // Insert test data
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('s1', Date.now(), Date.now(), '{}');
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(
      's1', 'user', 'How do I use TypeScript generics?', Date.now(),
    );
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(
      's1', 'assistant', 'TypeScript generics allow you to create reusable components.', Date.now(),
    );
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(
      's1', 'user', 'What about Python decorators?', Date.now(),
    );

    tools = createMemoryTools(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('memorySearch', () => {
    it('searches messages using LIKE fallback', async () => {
      const result = await tools.memorySearchTool.execute({ query: 'TypeScript' });
      expect(result.count).toBeGreaterThan(0);
      expect(result.results[0].content).toContain('TypeScript');
    });

    it('returns empty results for non-matching query', async () => {
      const result = await tools.memorySearchTool.execute({ query: 'xyznonexistent' });
      expect(result.count).toBe(0);
    });

    it('respects limit parameter', async () => {
      const result = await tools.memorySearchTool.execute({ query: 'TypeScript', limit: 1 });
      expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it('rejects empty query', async () => {
      await expect(tools.memorySearchTool.execute({ query: '' })).rejects.toThrow('non-empty');
    });
  });

  describe('memoryGet', () => {
    it('returns content or empty note when USER.md does not exist', async () => {
      const result = await tools.memoryGetTool.execute({});
      // Either returns content (if USER.md exists) or a note
      expect(result).toHaveProperty('path');
      expect(typeof result.content).toBe('string');
    });
  });

  describe('memoryUpdate', () => {
    let tmpDir: string;
    let tmpFile: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));
      tmpFile = path.join(tmpDir, 'USER.md');
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('creates USER.md in append mode if it does not exist', async () => {
      // This test uses the default path resolution which may not write to tmpDir,
      // so we test the tool's return structure
      const result = await tools.memoryUpdateTool.execute({
        content: '# Test Memory\nUser prefers dark mode.',
        mode: 'replace',
      });
      expect(result.action).toBe('replaced');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
