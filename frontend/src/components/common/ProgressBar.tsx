interface ProgressBarProps {
  value: number;
  label?: string;
  color?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  label,
  color = 'bg-blue-500',
}) => {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="w-full">
      {label && (
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-gray-700">{label}</span>
          <span className="text-gray-500">{Math.round(clamped)}%</span>
        </div>
      )}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${clamped}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ?? 'Progress'}
        />
      </div>
    </div>
  );
};

export default ProgressBar;
