type IconName =
  | "select"
  | "wire"
  | "text"
  | "image"
  | "hand"
  | "undo"
  | "redo"
  | "save"
  | "open"
  | "fit"
  | "plus"
  | "search"
  | "trash"
  | "close"
  | "settings"
  | "chevron-left"
  | "chevron-right";

const paths: Record<IconName, React.ReactNode> = {
  select: <path d="M5 3.7 18.2 12l-6.1 1.1-3.6 5.2L5 3.7Z" />,
  wire: <path d="M4 17.5h3.8l2.4-11h3.6l2.4 11H20M4 17.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm16 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />,
  text: <path d="M5 5V3.5h14V5M12 4v16m-4 0h8" />,
  image: <path d="M4 5h16v14H4V5Zm0 10 4.5-4.5 3.4 3.4 2.1-2.1 6 6M15.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />,
  hand: <path d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V10m0-5.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V11m0-3.5a1.5 1.5 0 0 1 3 0v5.2c0 5-2.8 7.3-7 7.3-3.5 0-5.2-1.7-6.8-4.2L4 13.2a1.7 1.7 0 0 1 2.6-2.1l.9.9" />,
  undo: <path d="m9 7-5 5 5 5M5 12h8a6 6 0 0 1 6 6" />,
  redo: <path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6" />,
  save: <path d="M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-7h8v7" />,
  open: <path d="M3.5 7.5h7l2-2H20v14H4l-.5-12Zm.5 12 3-8h14l-3 8" />,
  fit: <path d="M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <path d="m20 20-4.3-4.3M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z" />,
  trash: <path d="M5 7h14M9 7V4h6v3m2 0-1 14H8L7 7m3 4v6m4-6v6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  settings: <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5.5 1.1 2.3 2.5.7 2-1.5 1.9 1.9-1.5 2 .7 2.5L21 12l-2.3 1.1-.7 2.5 1.5 2-1.9 1.9-2-1.5-2.5.7L12 21l-1.1-2.3-2.5-.7-2 1.5-1.9-1.9 1.5-2-.7-2.5L3 12l2.3-1.1L6 8.4l-1.5-2 1.9-1.9 2 1.5 2.5-.7L12 3Z" />,
  "chevron-left": <path d="m14.5 6-6 6 6 6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
