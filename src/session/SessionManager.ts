/**
 * Session Manager
 * Handles conversation session lifecycle and persistence
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { Session, Message, SessionMetadata } from '../types';
import { JsonlSessionStore } from './JsonlSessionStore';

/**
 * Custom error for database operations
 */
export class DatabaseError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * LRU Cache for sessions
 * Uses a Map (insertion-order) to implement LRU eviction
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value as K;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

const SESSION_CACHE_MAX_SIZE = 100;

/**
 * Session Manager class
 * Manages conversation sessions with SQLite persistence
 */
export class SessionManager {
  private db: Database.Database;
  private cache: LRUCache<string, Session>;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private jsonl: JsonlSessionStore;
  private summarizer: ((messages: Message[]) => Promise<string>) | null = null;
  /** Tracks how many messages have already been written to JSONL per session */
  private jsonlCursors: Map<string, number> = new Map();

  constructor(db: Database.Database, jsonlBasePath?: string) {
    this.db = db;
    this.cache = new LRUCache<string, Session>(SESSION_CACHE_MAX_SIZE);
    this.jsonl = new JsonlSessionStore(jsonlBasePath);
  }

  /**
   * Set an LLM-based summarizer for context compaction.
   * When set, compact() will use this function to summarize old messages
   * instead of simply truncating them.
   *
   * OpenPilot: uses a small model (e.g. Haiku) to compress old conversation
   * history and extract long-term memories.
   *
   * @param fn - Async function that takes old messages and returns a summary string
   */
  setSummarizer(fn: (messages: Message[]) => Promise<string>): void {
    this.summarizer = fn;
  }

  /**
   * Create a new session with unique ID
   * @param metadata - Initial session metadata
   * @param id - Optional session ID (must be valid UUID format). If omitted, a random UUID is generated.
   * @returns New session object
   */
  async create(metadata: SessionMetadata, id?: string): Promise<Session> {
    try {
      // Validate custom ID format if provided (UUID, alphanumeric, or channel session keys with colons)
      if (id !== undefined) {
        if (typeof id !== 'string' || id.trim() === '' || !/^[a-zA-Z0-9_:.-]{1,200}$/.test(id)) {
          throw new DatabaseError(`Invalid session ID format: ${id}`);
        }
      }

      const session: Session = {
        id: id ?? randomUUID(),
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata
      };

      // Insert session into database
      this.db.prepare(`
        INSERT INTO sessions (id, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?)
      `).run(
        session.id,
        session.createdAt.getTime(),
        session.updatedAt.getTime(),
        JSON.stringify(session.metadata)
      );

      // OpenPilot: append session_create event to JSONL
      this.jsonl.onCreate(session.id, session.metadata).catch(() => {});

      return session;
    } catch (error) {
      const err = error as Error;
      throw new DatabaseError(`Failed to create session: ${err.message}`, err);
    }
  }

  /**
   * Returns cache hit/miss statistics
   */
  getCacheStats(): CacheStats {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total === 0 ? 0 : this.cacheHits / total,
    };
  }

  /**
   * Load session from database
   * @param sessionId - Session ID to load
   * @returns Session object with all messages (deep clone — safe to mutate)
   * @throws {DatabaseError} if session not found or database error occurs
   */
  async load(sessionId: string): Promise<Session> {
    // Check cache first
    const cached = this.cache.get(sessionId);
    if (cached) {
      this.cacheHits++;
      return this.cloneSession(cached);
    }
    this.cacheMisses++;

    try {
      // Load session metadata
      const sessionRow = this.db.prepare(`
        SELECT id, created_at, updated_at, metadata
        FROM sessions
        WHERE id = ?
      `).get(sessionId) as any;

      if (!sessionRow) {
        throw new DatabaseError(`Session not found: ${sessionId}`);
      }

      // Load messages for this session
      const messageRows = this.db.prepare(`
        SELECT role, content, timestamp, tool_calls, tool_results
        FROM messages
        WHERE session_id = ?
        ORDER BY timestamp ASC
      `).all(sessionId) as any[];

      // Convert database rows to Message objects
      const messages: Message[] = messageRows.map(row => ({
        role: row.role,
        content: row.content,
        timestamp: new Date(row.timestamp),
        toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined
      }));

      // Construct session object
      const session: Session = {
        id: sessionRow.id,
        messages,
        createdAt: new Date(sessionRow.created_at),
        updatedAt: new Date(sessionRow.updated_at),
        metadata: JSON.parse(sessionRow.metadata)
      };

      // Cache the loaded session
      this.cache.set(sessionId, session);

      return session;
    } catch (error) {
      const err = error as Error;
      if (err instanceof DatabaseError) {
        throw err;
      }
      throw new DatabaseError(`Failed to load session: ${err.message}`, err);
    }
  }

  /**
   * Save session to database
   * @param session - Session object to persist
   * @throws {DatabaseError} if database error occurs
   */
  async save(session: Session): Promise<void> {
    try {
      // Use transaction for atomic operation
      const saveTransaction = this.db.transaction(() => {
        // Upsert session metadata
        this.db.prepare(`
          INSERT INTO sessions (id, created_at, updated_at, metadata)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at,
            metadata = excluded.metadata
        `).run(
          session.id,
          session.createdAt.getTime(),
          session.updatedAt.getTime(),
          JSON.stringify(session.metadata)
        );

        // Delete existing messages for this session
        this.db.prepare(`
          DELETE FROM messages WHERE session_id = ?
        `).run(session.id);

        // Insert all messages
        const insertMessage = this.db.prepare(`
          INSERT INTO messages (session_id, role, content, timestamp, tool_calls, tool_results)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const message of session.messages) {
          insertMessage.run(
            session.id,
            message.role,
            message.content,
            message.timestamp.getTime(),
            message.toolCalls ? JSON.stringify(message.toolCalls) : null,
            message.toolResults ? JSON.stringify(message.toolResults) : null
          );
        }
      });

      saveTransaction();

      // OpenPilot: append only NEW messages to JSONL audit trail (incremental)
      const cursor = this.jsonlCursors.get(session.id) ?? 0;
      if (session.messages.length > cursor) {
        const newMessages = session.messages.slice(cursor);
        this.jsonl.onMessagesAppended(session.id, newMessages).catch(() => {});
        this.jsonlCursors.set(session.id, session.messages.length);
      }

      // Update cache with saved session (store a clone to prevent mutation)
      this.cache.set(session.id, this.cloneSession(session));
    } catch (error) {
      const err = error as Error;
      throw new DatabaseError(`Failed to save session: ${err.message}`, err);
    }
  }

  /**
   * Delete session from database
   * @param sessionId - Session ID to delete
   * @throws {DatabaseError} if database error occurs
   */
  async delete(sessionId: string): Promise<void> {
    try {
      const result = this.db.prepare(`
        DELETE FROM sessions WHERE id = ?
      `).run(sessionId);

      // Messages are automatically deleted via CASCADE
      if (result.changes === 0) {
        throw new DatabaseError(`Session not found: ${sessionId}`);
      }

      // OpenPilot: record soft-delete in JSONL (file preserved for audit)
      this.jsonl.onDelete(sessionId).catch(() => {});

      // Invalidate cache and cursor
      this.cache.delete(sessionId);
      this.jsonlCursors.delete(sessionId);
    } catch (error) {
      const err = error as Error;
      if (err instanceof DatabaseError) {
        throw err;
      }
      throw new DatabaseError(`Failed to delete session: ${err.message}`, err);
    }
  }

  /**
   * Deep clone a session to prevent cache mutation.
   */
  private cloneSession(session: Session): Session {
    return {
      id: session.id,
      messages: session.messages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp.getTime()),
        toolCalls: m.toolCalls ? m.toolCalls.map(tc => ({ ...tc, arguments: { ...tc.arguments } })) : undefined,
        toolResults: m.toolResults ? m.toolResults.map(tr => ({ ...tr })) : undefined,
      })),
      createdAt: new Date(session.createdAt.getTime()),
      updatedAt: new Date(session.updatedAt.getTime()),
      metadata: { ...session.metadata },
    };
  }

  /**
   * Compact session by summarizing old messages (LLM-based) or truncating.
   *
   * OpenPilot Context Compaction:
   * - If a summarizer is set, old messages are summarized into a single
   *   system message, preserving context while reducing token count.
   * - If no summarizer, falls back to keeping the most recent 10 messages.
   *
   * @param sessionId - Session ID to compact
   * @throws {DatabaseError} if database error occurs
   */
  async compact(sessionId: string): Promise<void> {
    try {
      const session = await this.load(sessionId);

      const systemMessages: Message[] = [];
      const otherMessages: Message[] = [];

      for (const message of session.messages) {
        if (message.role === 'system') {
          systemMessages.push(message);
        } else {
          otherMessages.push(message);
        }
      }

      const MAX_RECENT = 10;

      if (this.summarizer && otherMessages.length > MAX_RECENT) {
        // LLM-based summarization: summarize old messages, keep recent ones
        const oldMessages = otherMessages.slice(0, -MAX_RECENT);
        const recentMessages = otherMessages.slice(-MAX_RECENT);

        try {
          const summary = await this.summarizer(oldMessages);
          const summaryMessage: Message = {
            role: 'system',
            content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
            timestamp: new Date(),
          };
          session.messages = [...systemMessages, summaryMessage, ...recentMessages];
        } catch {
          // Summarizer failed — fall back to truncation
          session.messages = [...systemMessages, ...otherMessages.slice(-MAX_RECENT)];
        }
      } else {
        // Simple truncation fallback
        session.messages = [...systemMessages, ...otherMessages.slice(-MAX_RECENT)];
      }

      session.updatedAt = new Date();

      // OpenPilot: record compaction event in JSONL
      this.jsonl.onCompact(sessionId, session.messages.length).catch(() => {});

      // Reset JSONL cursor since messages were replaced
      this.jsonlCursors.set(sessionId, 0);

      await this.save(session);
    } catch (error) {
      const err = error as Error;
      if (err instanceof DatabaseError) {
        throw err;
      }
      throw new DatabaseError(`Failed to compact session: ${err.message}`, err);
    }
  }
}
