/**
 * SessionManager unit tests
 */

import { SessionManager, DatabaseError } from './SessionManager';
import { initializeDatabase } from './database';
import { Session, SessionMetadata } from '../types';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

describe('SessionManager', () => {
  let db: Database.Database;
  let sessionManager: SessionManager;
  const testDbPath = './test-data/session-manager-test.db';

  beforeEach(() => {
    // Clean up and create fresh database
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = initializeDatabase(testDbPath);
    sessionManager = new SessionManager(db);
  });

  afterEach(() => {
    // Close database and clean up
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  });

  describe('create()', () => {
    it('should create a new session with unique ID', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(session.messages).toEqual([]);
      expect(session.metadata).toEqual(metadata);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    it('should generate unique IDs for multiple sessions', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session1 = await sessionManager.create(metadata);
      const session2 = await sessionManager.create(metadata);

      expect(session1.id).not.toBe(session2.id);
    });

    it('should persist session to database', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);

      // Verify in database
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id) as any;
      expect(row).toBeDefined();
      expect(row.id).toBe(session.id);
    });
  });

  describe('load()', () => {
    it('should load an existing session', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 100,
        cost: 0.01
      };

      const created = await sessionManager.create(metadata);
      const loaded = await sessionManager.load(created.id);

      expect(loaded.id).toBe(created.id);
      expect(loaded.metadata).toEqual(metadata);
      expect(loaded.messages).toEqual([]);
    });

    it('should load session with messages', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 100,
        cost: 0.01
      };

      const session = await sessionManager.create(metadata);
      
      // Add messages
      session.messages.push({
        role: 'user',
        content: 'Hello',
        timestamp: new Date()
      });
      session.messages.push({
        role: 'assistant',
        content: 'Hi there!',
        timestamp: new Date()
      });

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].role).toBe('user');
      expect(loaded.messages[0].content).toBe('Hello');
      expect(loaded.messages[1].role).toBe('assistant');
      expect(loaded.messages[1].content).toBe('Hi there!');
    });

    it('should load messages in timestamp order', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      const now = Date.now();
      session.messages.push({
        role: 'user',
        content: 'First',
        timestamp: new Date(now)
      });
      session.messages.push({
        role: 'assistant',
        content: 'Second',
        timestamp: new Date(now + 1000)
      });
      session.messages.push({
        role: 'user',
        content: 'Third',
        timestamp: new Date(now + 2000)
      });

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages[0].content).toBe('First');
      expect(loaded.messages[1].content).toBe('Second');
      expect(loaded.messages[2].content).toBe('Third');
    });

    it('should throw DatabaseError for non-existent session', async () => {
      await expect(sessionManager.load('non-existent-id'))
        .rejects
        .toThrow(DatabaseError);
    });

    it('should load messages with tool calls and results', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      session.messages.push({
        role: 'assistant',
        content: 'Let me read that file',
        timestamp: new Date(),
        toolCalls: [{
          id: 'call_123',
          name: 'readFile',
          arguments: { path: 'test.txt' }
        }],
        toolResults: [{
          id: 'call_123',
          result: 'File content here'
        }]
      });

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages[0].toolCalls).toHaveLength(1);
      expect(loaded.messages[0].toolCalls![0].name).toBe('readFile');
      expect(loaded.messages[0].toolResults).toHaveLength(1);
      expect(loaded.messages[0].toolResults![0].result).toBe('File content here');
    });
  });

  describe('save()', () => {
    it('should save a new session', async () => {
      const session: Session = {
        id: 'test-session-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          model: 'gpt-4',
          totalTokens: 0,
          cost: 0
        }
      };

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.id).toBe(session.id);
    });

    it('should update an existing session', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 100,
        cost: 0.01
      };

      const session = await sessionManager.create(metadata);
      
      // Update metadata
      session.metadata.totalTokens = 200;
      session.metadata.cost = 0.02;
      session.updatedAt = new Date();

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.metadata.totalTokens).toBe(200);
      expect(loaded.metadata.cost).toBe(0.02);
    });

    it('should save session with messages', async () => {
      const session: Session = {
        id: 'test-session-2',
        messages: [
          {
            role: 'user',
            content: 'Hello',
            timestamp: new Date()
          },
          {
            role: 'assistant',
            content: 'Hi!',
            timestamp: new Date()
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          model: 'gpt-4',
          totalTokens: 50,
          cost: 0.005
        }
      };

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages).toHaveLength(2);
    });

    it('should replace messages on update', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      // Add initial messages
      session.messages.push({
        role: 'user',
        content: 'First message',
        timestamp: new Date()
      });

      await sessionManager.save(session);

      // Update with new messages
      session.messages = [{
        role: 'user',
        content: 'Updated message',
        timestamp: new Date()
      }];

      await sessionManager.save(session);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages).toHaveLength(1);
      expect(loaded.messages[0].content).toBe('Updated message');
    });
  });

  describe('delete()', () => {
    it('should delete an existing session', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      await sessionManager.delete(session.id);

      await expect(sessionManager.load(session.id))
        .rejects
        .toThrow(DatabaseError);
    });

    it('should cascade delete messages', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      session.messages.push({
        role: 'user',
        content: 'Test message',
        timestamp: new Date()
      });

      await sessionManager.save(session);

      // Verify message exists
      let messages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
        .get(session.id) as any;
      expect(messages.count).toBe(1);

      await sessionManager.delete(session.id);

      // Verify messages were deleted
      messages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
        .get(session.id) as any;
      expect(messages.count).toBe(0);
    });

    it('should throw DatabaseError for non-existent session', async () => {
      await expect(sessionManager.delete('non-existent-id'))
        .rejects
        .toThrow(DatabaseError);
    });
  });

  describe('compact()', () => {
    it('should preserve all system messages', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      // Add system messages and user messages
      const now = Date.now();
      session.messages.push(
        { role: 'system', content: 'System 1', timestamp: new Date(now) },
        { role: 'system', content: 'System 2', timestamp: new Date(now + 1000) },
        { role: 'user', content: 'User 1', timestamp: new Date(now + 2000) },
        { role: 'user', content: 'User 2', timestamp: new Date(now + 3000) }
      );

      await sessionManager.save(session);
      await sessionManager.compact(session.id);

      const loaded = await sessionManager.load(session.id);
      const systemMessages = loaded.messages.filter(m => m.role === 'system');
      expect(systemMessages).toHaveLength(2);
    });

    it('should keep most recent 10 non-system messages', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      // Add 15 user/assistant messages
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(now + i * 1000)
        });
      }

      await sessionManager.save(session);
      await sessionManager.compact(session.id);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages).toHaveLength(10);
      
      // Verify we kept the most recent messages (5-14)
      expect(loaded.messages[0].content).toBe('Message 5');
      expect(loaded.messages[9].content).toBe('Message 14');
    });

    it('should preserve system messages and recent messages together', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      const now = Date.now();
      // Add 2 system messages
      session.messages.push(
        { role: 'system', content: 'System 1', timestamp: new Date(now) },
        { role: 'system', content: 'System 2', timestamp: new Date(now + 1000) }
      );
      
      // Add 15 user/assistant messages
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(now + 2000 + i * 1000)
        });
      }

      await sessionManager.save(session);
      await sessionManager.compact(session.id);

      const loaded = await sessionManager.load(session.id);
      
      // Should have 2 system + 10 recent = 12 total
      expect(loaded.messages).toHaveLength(12);
      
      const systemMessages = loaded.messages.filter(m => m.role === 'system');
      expect(systemMessages).toHaveLength(2);
      
      const otherMessages = loaded.messages.filter(m => m.role !== 'system');
      expect(otherMessages).toHaveLength(10);
    });

    it('should update session timestamp after compaction', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      const originalUpdatedAt = session.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await sessionManager.compact(session.id);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should handle session with fewer than 10 messages', async () => {
      const metadata: SessionMetadata = {
        model: 'gpt-4',
        totalTokens: 0,
        cost: 0
      };

      const session = await sessionManager.create(metadata);
      
      // Add only 5 messages
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date(now + i * 1000)
        });
      }

      await sessionManager.save(session);
      await sessionManager.compact(session.id);

      const loaded = await sessionManager.load(session.id);
      expect(loaded.messages).toHaveLength(5);
    });

    it('should throw DatabaseError for non-existent session', async () => {
      await expect(sessionManager.compact('non-existent-id'))
        .rejects
        .toThrow(DatabaseError);
    });
  });

  describe('error handling', () => {
    it('should wrap database errors in DatabaseError', async () => {
      // Close the database to force an error
      db.close();

      await expect(sessionManager.load('any-id'))
        .rejects
        .toThrow(DatabaseError);
    });

    it('should include error message in DatabaseError', async () => {
      try {
        await sessionManager.load('non-existent-id');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).message).toContain('Session not found');
      }
    });
  });
});
