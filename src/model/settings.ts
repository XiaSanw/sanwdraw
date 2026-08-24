import type { SanwDocument } from "./types";

export const DEFAULT_PORT_GAP = 16;
export const MIN_PORT_GAP = 0;
export const MAX_PORT_GAP = 60;
export const PORT_BOX_WIDTH = 64;
export const PORT_BOX_HEIGHT = 23;

export const clampPortGap = (value: number) =>
  Math.max(MIN_PORT_GAP, Math.min(MAX_PORT_GAP, Math.round(value)));

export const getDocumentPortGap = (document: SanwDocument) =>
  clampPortGap(document.settings?.portGap ?? DEFAULT_PORT_GAP);
