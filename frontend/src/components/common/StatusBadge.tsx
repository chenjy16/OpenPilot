type BadgeStatus = 'running' | 'idle' | 'error' | 'success' | 'warning' | 'info';

interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
}

const STATUS_STYLES: Record<BadgeStatus, string> = {
  running: 'bg-blue-100 text-blue-700',
  idle: 'bg-gray-100 text-gray-700',
  error: 'bg-red-100 text-red-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  info: 'bg-sky-100 text-sky-700',
};

const DEFAULT_LABELS: Record<BadgeStatus, string> = {
  running: '运行中',
  idle: '空闲',
  error: '错误',
  success: '成功',
  warning: '警告',
  info: '信息',
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {label ?? DEFAULT_LABELS[status]}
    </span>
  );
};

export default StatusBadge;
