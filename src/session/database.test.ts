/**
 * Database initialization tests
 */

import { initializeDatabase, closeDatabase } from './database';
import fs from 'fs';
import path from 'path';

describe('Database Initialization', () => {
  const testDbPath = './test-data/test-sessions.db';

  beforeEach(() => {
    // Clean up test database before each test
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    // Close database connection and clean up
    closeDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(dir)) {
      fs.rmdirSync(dir);
    }
  });

  it('should create database file and directory', () => {
    const db = initializeDatabase(testDbPath);
    expect(fs.existsSync(testDbPath)).toBe(true);
    db.close();
  });

  it('should create sessions table with correct schema', () => {
    const db = initializeDatabase(testDbPath);
    
    const tableInfo = db.prepare(`PRAGMA table_info(sessions)`).all();
    const columnNames = tableInfo.map((col: any) => col.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
    expect(columnNames).toContain('metadata');
    
    db.close();
  });

  it('should create messages table with correct schema', () => {
    const db = initializeDatabase(testDbPath);
    
    const tableInfo = db.prepare(`PRAGMA table_info(messages)`).all();
    const columnNames = tableInfo.map((col: any) => col.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('session_id');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('content');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('tool_calls');
    expect(columnNames).toContain('tool_results');
    
    db.close();
  });

  it('should create indexes on session_id', () => {
    const db = initializeDatabase(testDbPath);
    
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='messages'
    `).all();
    
    const indexNames = indexes.map((idx: any) => idx.name);
    expect(indexNames).toContain('idx_messages_session_id');
    expect(indexNames).toContain('idx_messages_timestamp');
    
    db.close();
  });

  it('should enforce foreign key constraints', () => {
    const db = initializeDatabase(testDbPath);
    
    const foreignKeys = db.pragma('foreign_keys');
    expect(foreignKeys).toEqual([{ foreign_keys: 1 }]);
    
    db.close();
  });

  it('should enforce role check constraint', () => {
    const db = initializeDatabase(testDbPath);
    
    // Insert a valid session first
    db.prepare(`
      INSERT INTO sessions (id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?)
    `).run('test-session', Date.now(), Date.now(), '{}');
    
    // Try to insert message with invalid role
    expect(() => {
      db.prepare(`
        INSERT INTO messages (session_id, role, content, timestamp)
        VALUES (?, ?, ?, ?)
      `).run('test-session', 'invalid-role', 'test content', Date.now());
    }).toThrow();
    
    db.close();
  });

  it('should allow valid role values', () => {
    const db = initializeDatabase(testDbPath);
    
    // Insert a valid session first
    db.prepare(`
      INSERT INTO sessions (id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?)
    `).run('test-session', Date.now(), Date.now(), '{}');
    
    // Insert messages with valid roles
    const validRoles = ['user', 'assistant', 'system'];
    validRoles.forEach((role, index) => {
      expect(() => {
        db.prepare(`
          INSERT INTO messages (session_id, role, content, timestamp)
          VALUES (?, ?, ?, ?)
        `).run('test-session', role, `test content ${index}`, Date.now());
      }).not.toThrow();
    });
    
    // Verify all messages were inserted
    const messages = db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as any;
    expect(messages.count).toBe(3);
    
    db.close();
  });

  it('should cascade delete messages when session is deleted', () => {
    const db = initializeDatabase(testDbPath);
    
    // Insert a session
    db.prepare(`
      INSERT INTO sessions (id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?)
    `).run('test-session', Date.now(), Date.now(), '{}');
    
    // Insert messages
    db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `).run('test-session', 'user', 'test message', Date.now());
    
    // Verify message exists
    let messages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE session_id = ?`).get('test-session') as any;
    expect(messages.count).toBe(1);
    
    // Delete session
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run('test-session');
    
    // Verify messages were cascade deleted
    messages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE session_id = ?`).get('test-session') as any;
    expect(messages.count).toBe(0);
    
    db.close();
  });

  it('should be idempotent - can be called multiple times', () => {
    const db1 = initializeDatabase(testDbPath);
    db1.close();
    
    // Initialize again - should not throw
    expect(() => {
      const db2 = initializeDatabase(testDbPath);
      db2.close();
    }).not.toThrow();
  });
});
