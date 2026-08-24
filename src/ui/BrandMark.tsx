export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className="brand-mark-svg"
    >
      <defs>
        <linearGradient id="bm-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fefdf8" />
          <stop offset="1" stopColor="#f1eddf" />
        </linearGradient>
        <linearGradient id="bm-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5c8ae0" />
          <stop offset="1" stopColor="#3a6cd4" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="212" fill="url(#bm-tile)" />
      <rect x="256" y="256" width="512" height="512" rx="118" fill="none" stroke="url(#bm-ring)" strokeWidth="46" />
      <path d="M 344 392 H 444 Q 496 392 496 444 V 572" fill="none" stroke="#2f5cc2" strokeWidth="42" strokeLinecap="round" />
      <circle cx="496" cy="572" r="36" fill="#2f5cc2" />
      <path d="M 680 632 H 612 Q 560 632 560 580 V 452" fill="none" stroke="#9dbdf1" strokeWidth="42" strokeLinecap="round" />
      <circle cx="560" cy="452" r="36" fill="#9dbdf1" />
      <g fill="#fdfbf4" stroke="#3a6cd4" strokeWidth="30">
        <rect x="434" y="210" width="156" height="92" rx="28" />
        <rect x="434" y="722" width="156" height="92" rx="28" />
        <rect x="210" y="466" width="92" height="156" rx="28" />
        <rect x="722" y="466" width="92" height="156" rx="28" />
      </g>
    </svg>
  );
}
