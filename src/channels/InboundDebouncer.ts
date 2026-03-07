/**
 * InboundDebouncer — merges consecutive messages within a configurable window.
 *
 * When a user sends multiple short messages in quick succession (e.g. typing
 * line-by-line), the debouncer collects them and delivers a single merged
 * message to the agent, reducing unnecessary AI calls.
 *
 * Design doc: "Channel 消息处理与设备管理.md" §InboundDebouncer
 */

import { ChannelMessage } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebouncerConfig {
  /** Debounce window in milliseconds (default 1500ms) */
  windowMs?: number;
  /** Maximum messages to merge in one window (default 10) */
  maxMerge?: number;
}

interface PendingEntry {
  messages: ChannelMessage[];
  timer: ReturnType<typeof setTimeout>;
}

export type DebouncedCallback = (merged: ChannelMessage) => Promise<void>;

// ---------------------------------------------------------------------------
// InboundDebouncer
// ---------------------------------------------------------------------------

export class InboundDebouncer {
  private pending: Map<string, PendingEntry> = new Map();
  private windowMs: number;
  private maxMerge: number;
  private callback: DebouncedCallback;

  constructor(callback: DebouncedCallback, config?: DebouncerConfig) {
    this.callback = callback;
    this.windowMs = config?.windowMs ?? 1500;
    this.maxMerge = config?.maxMerge ?? 10;
  }

  /**
   * Enqueue a message for debouncing.
   * Key is derived from channel + chatId + senderId to isolate per-conversation.
   */
  enqueue(message: ChannelMessage): void {
    const key = `${message.channelType}:${message.chatId}:${message.senderId}`;
    const existing = this.pending.get(key);

    if (existing) {
      existing.messages.push(message);
      // If we hit max, flush immediately
      if (existing.messages.length >= this.maxMerge) {
        clearTimeout(existing.timer);
        this.flush(key);
        return;
      }
      // Reset the timer
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.flush(key), this.windowMs);
      return;
    }

    // New entry — start timer
    const entry: PendingEntry = {
      messages: [message],
      timer: setTimeout(() => this.flush(key), this.windowMs),
    };
    this.pending.set(key, entry);
  }

  /**
   * Check if a text message should be debounced.
   * Short messages (< 200 chars, no attachments) are debounced.
   */
  shouldDebounce(message: ChannelMessage): boolean {
    if (message.attachments && message.attachments.length > 0) return false;
    if (message.content.length > 200) return false;
    return true;
  }

  /**
   * Flush pending messages for a key — merge and deliver.
   */
  private flush(key: string): void {
    const entry = this.pending.get(key);
    if (!entry || entry.messages.length === 0) {
      this.pending.delete(key);
      return;
    }

    this.pending.delete(key);
    const messages = entry.messages;

    // Merge: use the last message as base, concatenate content
    const merged: ChannelMessage = {
      ...messages[messages.length - 1],
      content: messages.map(m => m.content).join('\n'),
      // Keep the first message's ID and timestamp
      id: messages[0].id,
      timestamp: messages[0].timestamp,
    };

    this.callback(merged).catch(err => {
      console.error(`[InboundDebouncer] Flush callback error: ${err.message}`);
    });
  }

  /**
   * Cancel all pending debounce timers (for shutdown).
   */
  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  /** Number of pending debounce entries (for testing). */
  get pendingCount(): number {
    return this.pending.size;
  }
}
