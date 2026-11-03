import { Bot, Sparkles } from 'lucide-react';

interface AICloudLauncherProps {
  onClick?: () => void;
  statusColor?: string;
  className?: string;
  compact?: boolean;
}

export function AICloudLauncher({
  onClick,
  statusColor = '#43A047',
  className = '',
}: AICloudLauncherProps) {
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      // Dispatch global event for opening AI Cloud assistant
      window.dispatchEvent(new CustomEvent('alpas:open-ai-cloud'));
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`ai-cloud-launcher-card ${className}`}
      aria-label="Open AI Cloud Assistant"
    >
      {/* Icon */}
      <div className="ai-launcher-icon">
        <Bot size={18} strokeWidth={2.2} />
      </div>

      {/* Brand Info (Expanded state) */}
      <div className="ai-launcher-text">
        <span
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--color-text-primary, #1F2933)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          AI Farm Assistant
        </span>
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            color: 'var(--color-text-secondary, #667085)',
            lineHeight: 1.1,
            marginTop: 2,
            whiteSpace: 'nowrap',
          }}
        >
          Handa Tumulong
        </span>
      </div>

      {/* Online Status Pulse (Expanded state) */}
      <div className="ai-launcher-status">
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}`,
          }}
        />
        <Sparkles size={13} color="#42A5F5" style={{ opacity: 0.8 }} />
      </div>

      {/* Tooltip when collapsed */}
      <span className="alpas-nav-tooltip" role="tooltip">
        AI Cloud Assistant
      </span>
    </button>
  );
}
