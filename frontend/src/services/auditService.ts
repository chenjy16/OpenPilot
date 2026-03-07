import { useSecurityStore } from '../stores/securityStore';
import type { AuditLogEntry } from '../types';

/**
 * Log an executed action to the audit trail.
 */
export async function logExecuted(
  action: string,
  details: Record<string, unknown> = {},
  operator = 'user',
): Promise<void> {
  await useSecurityStore.getState().logAction({
    action,
    operator,
    details,
    status: 'executed',
  });
}

/**
 * Log a cancelled action (e.g. user dismissed the confirm dialog).
 */
export async function logCancelled(
  action: string,
  details: Record<string, unknown> = {},
  operator = 'user',
): Promise<void> {
  await useSecurityStore.getState().logAction({
    action,
    operator,
    details,
    status: 'cancelled',
  });
}

/**
 * Log a failed action.
 */
export async function logFailed(
  action: string,
  details: Record<string, unknown> = {},
  operator = 'user',
): Promise<void> {
  await useSecurityStore.getState().logAction({
    action,
    operator,
    details,
    status: 'failed',
  });
}

/**
 * Fetch audit logs with optional filters.
 */
export async function fetchLogs(filters?: {
  startTime?: string;
  endTime?: string;
  action?: string;
}): Promise<void> {
  await useSecurityStore.getState().fetchAuditLogs(filters);
}

/**
 * Get the current audit logs from the store (synchronous read).
 */
export function getLogs(): AuditLogEntry[] {
  return useSecurityStore.getState().auditLogs;
}
