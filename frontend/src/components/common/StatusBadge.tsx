import { useTranslation } from 'react-i18next';

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
  running: 'status.running',
  idle: 'status.idle',
  error: 'status.error',
  success: 'status.success',
  warning: 'status.warning',
  info: 'status.info',
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {label ?? t(DEFAULT_LABELS[status])}
    </span>
  );
};

export default StatusBadge;
