export type Point = { x: number; y: number };

export type InterfaceDomain = "power" | "signal";
export type PortEdge = "top" | "right" | "bottom" | "left";

export type InterfacePort = {
  id: string;
  name: string;
  domain: InterfaceDomain;
  protocol?: string;
  voltage?: string;
  /** Optional continuous/load current annotation, e.g. "2A" or "≤6A". */
  current?: string;
  /** Canvas instances may keep a template port available without rendering it. */
  enabled?: boolean;
  edge: PortEdge;
  offset: number;
};

export type CanvasElementBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked?: boolean;
};

export type ComponentElement = CanvasElementBase & {
  kind: "component";
  templateId: string;
  templateVersion: number;
  name: string;
  description?: string;
  accent: string;
  resources: string[];
  ports: InterfacePort[];
};

export type TextElement = CanvasElementBase & {
  kind: "text";
  text: string;
  fontSize: number;
  color: string;
  weight: 400 | 500 | 600 | 700;
};

export type ImageElement = CanvasElementBase & {
  kind: "image";
  assetId: string;
  alt: string;
};

export type ShapeElement = CanvasElementBase & {
  kind: "shape";
  shape: "rectangle";
  fill: string;
  stroke: string;
  label?: string;
};

export type CanvasElement =
  | ComponentElement
  | TextElement
  | ImageElement
  | ShapeElement;

export type Network = {
  id: string;
  name: string;
  domain: InterfaceDomain;
  protocol?: string;
  memberIds: string[];
  color: string;
  /** Optional per-branch color overrides, keyed by port reference. */
  branchColors?: Record<string, string>;
  junction?: Point;
  /** Label offset from the internal junction; moving it never changes routing. */
  labelOffset?: Point;
  /** Intermediate bend points for each member branch, keyed by port reference. */
  routes?: Record<string, Point[]>;
};

export type AssetRecord = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type DocumentSettings = {
  /** Clear distance between a component frame and its surrounding port boxes. */
  portGap: number;
};

export type SanwDocument = {
  format: "sanwdraw";
  schemaVersion: 1;
  appVersion: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings?: DocumentSettings;
  /** Editable component definitions shown in the left library. */
  libraryTemplates?: ComponentTemplate[];
  elements: CanvasElement[];
  networks: Network[];
  assets: Record<string, AssetRecord>;
};

export type ComponentTemplate = {
  id: string;
  version: number;
  name: string;
  description: string;
  accent: string;
  width: number;
  height: number;
  resources: string[];
  ports: InterfacePort[];
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export const portRef = (componentId: string, portId: string) =>
  `${componentId}:${portId}`;

export const parsePortRef = (ref: string) => {
  const splitAt = ref.lastIndexOf(":");
  return {
    componentId: ref.slice(0, splitAt),
    portId: ref.slice(splitAt + 1),
  };
};

export const createId = (prefix: string) => {
  const uuid = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
};
