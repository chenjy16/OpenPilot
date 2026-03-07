/**
 * JSONL Session Store
 *
 * OpenPilot-aligned append-only session persistence.
 * Each session is stored as a JSONL file where each line is a JSON event:
 *   - session_create: initial metadata
 *   - message_append: a new message added to the session
 *   - session_compact: compaction marker (old messages replaced by summary)
 *   - session_delete: soft-delete marker
 *
 * File layout: <basePath>/<sessionId>.jsonl
 *
 * This store is designed to run alongside the existing SQLite SessionManager
 * during the migration period. The SQLite layer remains the source of truth
 * for reads; this layer provides the append-only audit trail that OpenPilot
 * expects for future Pi Agent Runtime integration.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Message, SessionMetadata } from '../types';

// ---------------------------------------------------------------------------
// JSONL event types
// ---------------------------------------------------------------------------

interface SessionCreateEvent {
  type: 'session_create';
  sessionId: string;
  metadata: SessionMetadata;
  timestamp: string;
}

interface MessageAppendEvent {
  type: 'message_append';
  sessionId: string;
  message: {
    role: string;
    content: string;
    timestamp: string;
    toolCalls?: unknown;
    toolResults?: unknown;
  };
  timestamp: string;
}

interface SessionCompactEvent {
  type: 'session_compact';
  sessionId: string;
  retainedMessageCount: number;
  timestamp: string;
}

interface SessionDeleteEvent {
  type: 'session_delete';
  sessionId: string;
  timestamp: string;
}

type JsonlEvent =
  | SessionCreateEvent
  | MessageAppendEvent
  | SessionCompactEvent
  | SessionDeleteEvent;

// ---------------------------------------------------------------------------
// JsonlSessionStore
// ---------------------------------------------------------------------------

export class JsonlSessionStore {
  private basePath: string;

  /**
   * @param basePath Directory where .jsonl files are stored.
   *                 Defaults to ./data/sessions-jsonl
   */
  constructor(basePath: string = './data/sessions-jsonl') {
    this.basePath = basePath;
  }

  /** Ensure the base directory exists. */
  async init(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  // -----------------------------------------------------------------------
  // Write helpers
  // -----------------------------------------------------------------------

  private filePath(sessionId: string): string {
    // Sanitise sessionId to prevent path traversal
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.basePath, `${safe}.jsonl`);
  }

  private async appendEvent(sessionId: string, event: JsonlEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.filePath(sessionId), line, 'utf-8');
  }

  // -----------------------------------------------------------------------
  // Public API — mirrors SessionManager lifecycle
  // -----------------------------------------------------------------------

  /** Record session creation. */
  async onCreate(sessionId: string, metadata: SessionMetadata): Promise<void> {
    await this.init();
    await this.appendEvent(sessionId, {
      type: 'session_create',
      sessionId,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  /** Record one or more messages appended to a session. */
  async onMessagesAppended(sessionId: string, messages: Message[]): Promise<void> {
    for (const msg of messages) {
      await this.appendEvent(sessionId, {
        type: 'message_append',
        sessionId,
        message: {
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : String(msg.timestamp),
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Record a compaction event. */
  async onCompact(sessionId: string, retainedMessageCount: number): Promise<void> {
    await this.appendEvent(sessionId, {
      type: 'session_compact',
      sessionId,
      retainedMessageCount,
      timestamp: new Date().toISOString(),
    });
  }

  /** Record session deletion (soft-delete — file is kept for audit). */
  async onDelete(sessionId: string): Promise<void> {
    await this.appendEvent(sessionId, {
      type: 'session_delete',
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  // -----------------------------------------------------------------------
  // Read helpers (for future Pi Runtime migration)
  // -----------------------------------------------------------------------

  /** Read all events for a session. */
  async readEvents(sessionId: string): Promise<JsonlEvent[]> {
    const fp = this.filePath(sessionId);
    let raw: string;
    try {
      raw = await fs.readFile(fp, 'utf-8');
    } catch {
      return [];
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JsonlEvent);
  }

  /** Reconstruct messages from JSONL events (for future reads). */
  async replayMessages(sessionId: string): Promise<Message[]> {
    const events = await this.readEvents(sessionId);
    const messages: Message[] = [];
    for (const evt of events) {
      if (evt.type === 'message_append') {
        messages.push({
          role: evt.message.role as Message['role'],
          content: evt.message.content,
          timestamp: new Date(evt.message.timestamp),
          toolCalls: evt.message.toolCalls as Message['toolCalls'],
          toolResults: evt.message.toolResults as Message['toolResults'],
        });
      } else if (evt.type === 'session_compact') {
        // After compaction, only the last N messages are valid.
        // Trim from the front.
        const keep = evt.retainedMessageCount;
        if (messages.length > keep) {
          messages.splice(0, messages.length - keep);
        }
      }
    }
    return messages;
  }
}
