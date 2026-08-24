import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Hand,
  Image,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Search,
  SlidersHorizontal,
  Spline,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";

export type IconName =
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
  | "minus"
  | "search"
  | "trash"
  | "close"
  | "settings"
  | "chevron-left"
  | "chevron-right";

const icons: Record<IconName, LucideIcon> = {
  select: MousePointer2,
  wire: Spline,
  text: Type,
  image: Image,
  hand: Hand,
  undo: Undo2,
  redo: Redo2,
  save: Save,
  open: FolderOpen,
  fit: Maximize,
  plus: Plus,
  minus: Minus,
  search: Search,
  trash: Trash2,
  close: X,
  settings: SlidersHorizontal,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" size={size} strokeWidth={1.8} />;
}
