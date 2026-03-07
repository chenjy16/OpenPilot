import { useCallback } from 'react';
import { usePermission } from './usePermission';
import { useConfirmStore } from '../stores/confirmStore';
import { logCancelled } from '../services/auditService';

/**
 * Hook that wraps an action with permission checking and confirmation dialog.
 *
 * - If the user lacks permission, the returned `allowed` is false.
 * - If the action requires confirmation (elevated/admin), invoking `execute`
 *   opens a ConfirmDialog. On confirm the action runs; on cancel the
 *   cancellation is recorded in the audit log.
 * - Normal-permission actions execute immediately without a dialog.
 */
export function useConfirmAction(
  action: string,
  opts: { title?: string; message?: string } = {},
) {
  const { allowed, level, requiresConfirmation, disabledTooltip } =
    usePermission(action);
  const showConfirm = useConfirmStore((s) => s.show);

  const execute = useCallback(
    (fn: () => void | Promise<void>, details?: Record<string, unknown>) => {
      if (!allowed) return;

      if (!requiresConfirmation) {
        fn();
        return;
      }

      const title = opts.title ?? '操作确认';
      const message =
        opts.message ??
        `此操作需要${level === 'admin' ? '管理员' : '高级'}权限，确认执行？`;

      showConfirm({
        title,
        message,
        onConfirm: () => {
          fn();
        },
        onCancel: () => {
          logCancelled(action, details ?? {});
        },
      });
    },
    [allowed, requiresConfirmation, level, action, opts.title, opts.message, showConfirm],
  );

  return { execute, allowed, level, requiresConfirmation, disabledTooltip };
}
