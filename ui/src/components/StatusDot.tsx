import React from 'react';

type StatusKind =
  | 'PUBLISHED'
  | 'PENDING'
  | 'REJECTED'
  | 'DRAFT'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'PAID'
  | 'UNPAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'PROCESSING'
  | string;

type Props = {
  label: StatusKind | React.ReactNode;
  title?: string;
  className?: string;
  /** Tailwind size classes for the dot (e.g. 'w-2 h-2'). Default: 'w-2 h-2' */
  dotSizeClass?: string;
  /** If you already know the tone, you can override detection with one of: success|warning|danger|info|muted */
  toneOverride?: 'success' | 'warning' | 'danger' | 'info' | 'muted';
};

/** Tiny colored status pill with a dot + label */
export const StatusDot: React.FC<Props> = ({
  label,
  title,
  className = '',
  dotSizeClass = 'w-2 h-2',
  toneOverride,
}) => {
  const raw = (typeof label === 'string' ? label : '').toUpperCase();

  const tone =
    toneOverride ??
    (raw.includes('LIVE') || raw === 'ACTIVE' || raw === 'PAID' || raw === 'COMPLETED'
      ? 'success'
      : raw.includes('PEND') || raw === 'PROCESSING'
      ? 'warning'
      : raw.includes('REJECT') || raw === 'FAILED' || raw === 'CANCELLED' || raw === 'INACTIVE'
      ? 'danger'
      : raw.includes('PUBLISHED') || raw.includes('INFO')
      ? 'info'
      : 'muted');

  const toneClasses: Record<
    NonNullable<Props['toneOverride']> | 'muted',
    { dot: string; text: string; bg: string; ring: string }
  > = {
    success: {
      dot: 'bg-emerald-600',
      text: 'text-emerald-800',
      bg: 'bg-emerald-50',
      ring: 'ring-emerald-100',
    },
    warning: {
      dot: 'bg-amber-600',
      text: 'text-amber-800',
      bg: 'bg-amber-50',
      ring: 'ring-amber-100',
    },
    danger: {
      dot: 'bg-rose-600',
      text: 'text-rose-800',
      bg: 'bg-rose-50',
      ring: 'ring-rose-100',
    },
    info: {
      dot: 'bg-sky-600',
      text: 'text-sky-800',
      bg: 'bg-sky-50',
      ring: 'ring-sky-100',
    },
    muted: {
      dot: 'bg-zinc-400',
      text: 'text-zinc-700',
      bg: 'bg-zinc-50',
      ring: 'ring-zinc-100',
    },
  };

  const c = toneClasses[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${c.bg} ${c.text} ring-1 ${c.ring} ${className}`}
      title={title || (typeof label === 'string' ? label : undefined)}
    >
      <span className={`inline-block rounded-full ${c.dot} ${dotSizeClass}`} />
      <span className="leading-none">
        {typeof label === 'string' ? label : label}
      </span>
    </span>
  );
};

export default StatusDot;
