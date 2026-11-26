import type { ReactNode } from 'react';

/** An empty list: one sentence on what is missing and the one action that fills it. */
export function EmptyState({
  title, message, action, testId, className = '',
}: {
  title?: string;
  message: ReactNode;
  /** The one control that fixes it (a button or a link). */
  action?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-[6px] border border-dashed border-slag px-4 py-3.5 ${className}`} data-testid={testId}>
      {title && <p className="text-[15px] font-medium text-bone">{title}</p>}
      <p className={`max-w-[60ch] text-ash ${title ? 'mt-1' : ''}`}>{message}</p>
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}
