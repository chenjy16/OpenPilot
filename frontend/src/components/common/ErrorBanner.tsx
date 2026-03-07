interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss }) => {
  return (
    <div
      className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3"
      role="alert"
    >
      <span className="text-sm text-red-700">{message}</span>
      {onDismiss && (
        <button
          className="ml-4 flex-shrink-0 text-red-500 hover:text-red-700"
          onClick={onDismiss}
          aria-label="关闭错误提示"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ErrorBanner;
