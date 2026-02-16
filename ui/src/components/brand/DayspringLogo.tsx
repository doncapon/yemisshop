import * as React from "react";

type Props = {
  className?: string;
  /** controls icon size; wordmark scales with it */
  size?: number;
  /** show/hide the "DaySpring" text */
  showText?: boolean;
};

export default function DaySpringLogo({
  className = "",
  size = 44, // ✅ bigger default icon
  showText = true,
}: Props) {
  // ✅ make text scale bigger relative to icon size
  const textPx = Math.round(size * 0.72);   // 44 -> ~32px
  const textPxMd = Math.round(size * 0.78); // 44 -> ~34px

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        aria-label="DaySpring"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="ds-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d946ef" />
            <stop offset="0.55" stopColor="#6366f1" />
            <stop offset="1" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="ds-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fb7185" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
          <clipPath id="ds-clip">
            <circle cx="24" cy="24" r="20" />
          </clipPath>
        </defs>

        {/* outer ring */}
        <circle cx="24" cy="24" r="21" fill="none" stroke="url(#ds-g)" strokeWidth="2.5" opacity="0.9" />
        <circle cx="24" cy="24" r="20" fill="white" opacity="0.85" />

        <g clipPath="url(#ds-clip)">
          {/* sun (top) */}
          <circle cx="24" cy="18" r="7.5" fill="url(#ds-sun)" opacity="0.95" />

          {/* rays */}
          {Array.from({ length: 9 }).map((_, i) => {
            const a = (-65 + i * 16) * (Math.PI / 180);
            const x1 = 24 + Math.cos(a) * 12;
            const y1 = 18 + Math.sin(a) * 12;
            const x2 = 24 + Math.cos(a) * 17;
            const y2 = 18 + Math.sin(a) * 17;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="url(#ds-sun)"
                strokeWidth="2.2"
                strokeLinecap="round"
                opacity="0.9"
              />
            );
          })}

          {/* horizon divider */}
          <path d="M4 26h40" stroke="rgba(15,23,42,0.08)" strokeWidth="2" />

          {/* waves (bottom) */}
          <path
            d="M0 34c6 0 7-4 13-4s7 4 12 4 7-4 12-4 7 4 11 4v14H0V34z"
            fill="url(#ds-g)"
            opacity="0.9"
          />
          <path
            d="M0 37c6 0 7-3 13-3s7 3 12 3 7-3 12-3 7 3 11 3"
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      </svg>

      {showText && (
        <span
          className="font-semibold tracking-tight text-zinc-900"
          style={{ fontSize: textPx }}
        >
          {/* bump slightly more on md+ */}
          <span className="hidden md:inline" style={{ fontSize: textPxMd }} />
          Day<span className="font-extrabold">Spring</span>
        </span>
      )}
    </div>
  );
}
