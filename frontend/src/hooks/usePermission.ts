import type { PermissionLevel } from '../types';
import { useSecurityStore } from '../stores/securityStore';

interface PermissionConfig {
  [action: string]: PermissionLevel;
}

export const PERMISSION_MAP: PermissionConfig = {
  // 普通权限 - 浏览器导航、文件浏览
  'browser.navigate': 'normal',
  'file.read': 'normal',
  // 高级权限 - 脚本执行、文件修改、加密解密
  'script.execute': 'elevated',
  'file.write': 'elevated',
  'file.delete': 'elevated',
  'crypto.encrypt': 'elevated',
  'crypto.decrypt': 'elevated',
  // 管理员权限 - 进程管理、系统配置
  'process.stop': 'admin',
  'process.restart': 'admin',
  'system.config': 'admin',
  'service.manage': 'admin',
};

const LEVEL_RANK: Record<PermissionLevel, number> = {
  normal: 0,
  elevated: 1,
  admin: 2,
};

export function getPermissionLevel(action: string): PermissionLevel {
  return PERMISSION_MAP[action] ?? 'admin';
}

export function getDisabledTooltip(
  actionLevel: PermissionLevel,
  userLevel: PermissionLevel,
): string | null {
  if (LEVEL_RANK[userLevel] >= LEVEL_RANK[actionLevel]) return null;
  const labels: Record<PermissionLevel, string> = {
    normal: '普通',
    elevated: '高级',
    admin: '管理员',
  };
  return `权限不足：此操作需要${labels[actionLevel]}权限`;
}

export function usePermission(action: string): {
  allowed: boolean;
  level: PermissionLevel;
  requiresConfirmation: boolean;
  disabledTooltip: string | null;
} {
  const userLevel = useSecurityStore((s) => s.userPermissionLevel);
  const level = getPermissionLevel(action);
  const allowed = LEVEL_RANK[userLevel] >= LEVEL_RANK[level];
  const requiresConfirmation = level !== 'normal';
  const disabledTooltip = allowed ? null : getDisabledTooltip(level, userLevel);

  return { allowed, level, requiresConfirmation, disabledTooltip };
}
