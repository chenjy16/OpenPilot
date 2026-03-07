/**
 * Audit Hook
 *
 * OpenPilot spec: all tool calls must be recorded in an audit log.
 * This module provides an after_tool_call hook that logs every
 * tool execution to the AuditLogger.
 */

import { ToolCallContext, AfterToolCallHook } from './ToolExecutor';
import { ToolResult } from '../types';

export interface AuditEntry {
  timestamp: string;
  sessionId?: string;
  toolName: string;
  arguments: Record<string, any>;
  status: 'success' | 'error' | 'blocked';
  error?: string;
  durationMs?: number;
}

/**
 * In-memory audit log with configurable max size.
 * Production: replace with persistent store (SQLite / file).
 */
export class AuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 10_000) {
    this.maxEntries = maxEntries;
  }

  append(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  query(filters?: {
    startTime?: string;
    endTime?: string;
    action?: string;
  }): AuditEntry[] {
    let result = this.entries;
    if (filters?.startTime) {
      const start = new Date(filters.startTime).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= start);
    }
    if (filters?.endTime) {
      const end = new Date(filters.endTime).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() <= end);
    }
    if (filters?.action) {
      result = result.filter(e => e.toolName === filters.action);
    }
    return result.slice().reverse(); // newest first
  }

  getAll(): AuditEntry[] {
    return this.entries.slice().reverse();
  }

  get size(): number {
    return this.entries.length;
  }
}

/**
 * Create an after_tool_call hook that records every execution to the audit logger.
 */
export function createAuditHook(logger: AuditLogger): AfterToolCallHook {
  return async (ctx: ToolCallContext, result: ToolResult): Promise<void> => {
    const status: AuditEntry['status'] = result.error
      ? (result.error.includes('blocked by policy') ? 'blocked' : 'error')
      : 'success';

    logger.append({
      timestamp: new Date().toISOString(),
      sessionId: ctx.sessionId,
      toolName: ctx.toolName,
      arguments: ctx.arguments,
      status,
      error: result.error,
    });
  };
}
