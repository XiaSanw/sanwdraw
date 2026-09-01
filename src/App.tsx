import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import "./App.css";
import {
  defaultRoutePointsToHub,
  documentBounds,
  getNetworkPoints,
  getPort,
  getPortPoint,
  nearestComponentEdgePlacement,
  nearestPointOnPath,
  networkHub,
  routeToHub,
  snapPointToOrthogonalAnchors,
} from "./canvas/geometry";
import { exportSanwdraw, importSanwdraw } from "./model/archive";
import { disconnectNetworkBranch, resetNetworkRoutesForMembers } from "./model/networks";
import { changedPortRefs, distributePortsOnEdges, movePortToEdge } from "./model/ports";
import { createSampleDocument } from "./model/sampleDocument";
import {
  clampPortGap,
  getDocumentPortGap,
  MAX_PORT_GAP,
  MIN_PORT_GAP,
  PORT_BOX_HEIGHT,
  PORT_BOX_WIDTH,
} from "./model/settings";
import { componentTemplates, instantiateTemplate, templateById } from "./model/templates";
import type {
  CanvasElement,
  ComponentElement,
  ImageElement,
  InterfacePort,
  Network,
  Point,
  PortEdge,
  SanwDocument,
  TextElement,
  Viewport,
} from "./model/types";
import { createId, portRef } from "./model/types";
import { BrandMark } from "./ui/BrandMark";
import { Icon } from "./ui/Icon";

type Tool = "select" | "wire" | "text" | "image" | "hand";
type Selection =
  | { kind: "element" | "network"; id: string }
  | { kind: "elements"; ids: string[] }
  | { kind: "branch"; networkId: string; memberRef: string }
  | null;
type History = { past: SanwDocument[]; present: SanwDocument; future: SanwDocument[] };
type ElementDrag = {
  pointerId: number;
  elementIds: string[];
  origin: Point;
  elementOrigins: Record<string, Point>;
  startDocument: SanwDocument;
};
type MarqueeDrag = {
  pointerId: number;
  origin: Point;
  current: Point;
  hitIds: string[];
  additive: boolean;
  baseIds: string[];
};
type PanDrag = { pointerId: number; clientOrigin: Point; viewportOrigin: Point };
type WireDraft = { sourceRef: string; cursor: Point };
type SnapGuides = { x?: number; y?: number };
type PortReposition = { componentId: string; portId: string };
type EditingPort = { componentId: string; portId: string };
type PortPress = {
  pointerId: number;
  componentId: string;
  portId: string;
  originEdge: PortEdge;
  startClient: Point;
  startDocument: SanwDocument;
  activated: boolean;
  moved: boolean;
};
type NetworkPointDrag =
  | {
      kind: "route";
      pointerId: number;
      networkId: string;
      memberRef: string;
      pointIndex: number;
      startDocument: SanwDocument;
    }
  | {
      kind: "junction";
      pointerId: number;
      networkId: string;
      startDocument: SanwDocument;
    };
type LibraryResize = {
  pointerId: number;
  startX: number;
  startWidth: number;
};

const WORLD_WIDTH = 6000;
const WORLD_HEIGHT = 4000;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.2;
const DEFAULT_LIBRARY_WIDTH = 238;
const MIN_LIBRARY_WIDTH = 180;
const MAX_LIBRARY_WIDTH = 420;
const ORTHOGONAL_SNAP_SCREEN_DISTANCE = 6;
const PORT_PRESS_MOVE_TOLERANCE = 10;
const LIBRARY_WIDTH_KEY = "sanwdraw.libraryWidth";
const LIBRARY_COLLAPSED_KEY = "sanwdraw.libraryCollapsed";

const clampLibraryWidth = (value: number) =>
  Math.max(MIN_LIBRARY_WIDTH, Math.min(MAX_LIBRARY_WIDTH, Math.round(value)));

const normalizeRect = (start: Point, end: Point) => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const elementIntersectsRect = (element: CanvasElement, rect: ReturnType<typeof normalizeRect>) =>
  element.x < rect.x + rect.width &&
  element.x + element.width > rect.x &&
  element.y < rect.y + rect.height &&
  element.y + element.height > rect.y;

const readStoredLibraryWidth = () => {
  const value = Number(window.localStorage.getItem(LIBRARY_WIDTH_KEY));
  return Number.isFinite(value) && value > 0
    ? clampLibraryWidth(value)
    : DEFAULT_LIBRARY_WIDTH;
};

const readStoredLibraryCollapsed = () =>
  window.localStorage.getItem(LIBRARY_COLLAPSED_KEY) === "true";

const toolItems: Array<{ id: Tool; label: string; shortcut: string }> = [
  { id: "select", label: "选择", shortcut: "V" },
  { id: "wire", label: "连线", shortcut: "W" },
  { id: "text", label: "文字", shortcut: "T" },
  { id: "image", label: "图片", shortcut: "I" },
  { id: "hand", label: "抓手", shortcut: "H" },
];

const colorForProtocol = (domain: "power" | "signal", protocol?: string) => {
  if (domain === "power") return "#df7b23";
  if (protocol === "CAN") return "#3472d1";
  if (protocol === "GPIO" || protocol === "PWM") return "#9a4d7b";
  if (protocol === "NPN" || protocol === "NPN/PNP") return "#15926b";
  return "#24829b";
};

const portDetails = (port: InterfacePort) => [
  port.protocol,
  `电压 ${port.voltage ?? "—"}`,
  `电流 ${port.current ?? "—"}`,
].filter(Boolean).join(" · ");

const PORT_OFFSET_MIN = 0.08;
const PORT_OFFSET_MAX = 0.92;

/** Move one port while keeping its neighbours separated on the affected edges. */
const movePortWithNeighbours = (
  component: ComponentElement,
  portId: string,
  placement: { edge: PortEdge; offset: number },
  originEdge: PortEdge,
) => {
  const movedPort = component.ports.find((port) => port.id === portId);
  if (!movedPort) return component.ports;
  let nextPorts = component.ports.map((port) =>
    port.id === portId
      ? { ...port, edge: placement.edge, offset: placement.offset }
      : port,
  );
  const affectedEdges = new Set<PortEdge>([originEdge, placement.edge]);

  affectedEdges.forEach((edge) => {
    const edgePorts = nextPorts.filter((port) => port.edge === edge);
    if (!edgePorts.length) return;
    if (edge !== placement.edge) {
      nextPorts = distributePortsOnEdges(nextPorts, [edge]);
      return;
    }

    const moving = edgePorts.find((port) => port.id === portId);
    if (!moving) return;
    const others = edgePorts
      .filter((port) => port.id !== portId)
      .sort((a, b) => a.offset - b.offset);
    const before = others.filter((port) => port.offset < placement.offset);
    const after = others.filter((port) => port.offset >= placement.offset);
    const span = PORT_OFFSET_MAX - PORT_OFFSET_MIN;
    const physicalGap = edge === "left" || edge === "right"
      ? (PORT_BOX_HEIGHT + 8) / component.height
      : (PORT_BOX_WIDTH + 8) / component.width;
    const gap = Math.min(span / Math.max(1, edgePorts.length - 1), physicalGap);
    const movingOffset = Math.max(
      PORT_OFFSET_MIN + before.length * gap,
      Math.min(PORT_OFFSET_MAX - after.length * gap, placement.offset),
    );
    const offsets = new Map<string, number>([[portId, movingOffset]]);
    let cursor = movingOffset - gap;
    for (let index = before.length - 1; index >= 0; index -= 1) {
      const port = before[index];
      const offset = Math.max(PORT_OFFSET_MIN, Math.min(port.offset, cursor));
      offsets.set(port.id, offset);
      cursor = offset - gap;
    }
    cursor = movingOffset + gap;
    after.forEach((port) => {
      const offset = Math.min(PORT_OFFSET_MAX, Math.max(port.offset, cursor));
      offsets.set(port.id, offset);
      cursor = offset + gap;
    });
    nextPorts = nextPorts.map((port) => {
      const offset = offsets.get(port.id);
      return offset === undefined ? port : { ...port, offset };
    });
  });
  return nextPorts;
};

const markUpdated = (document: SanwDocument): SanwDocument => ({
  ...document,
  updatedAt: new Date().toISOString(),
});

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, [contenteditable='true']"));
};

const safeFileName = (name: string) =>
  (name || "未命名工程")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "未命名工程";

const portEdgeLabels: Record<PortEdge, string> = {
  left: "左侧",
  right: "右侧",
  top: "顶部",
  bottom: "底部",
};

const nextPortPlacement = (ports: InterfacePort[]) => {
  const edges: PortEdge[] = ["right", "left", "bottom", "top"];
  const edge = edges.reduce((best, candidate) =>
    ports.filter((port) => port.edge === candidate).length
      < ports.filter((port) => port.edge === best).length
      ? candidate
      : best,
  );
  const positions = ports
    .filter((port) => port.edge === edge)
    .map((port) => port.offset)
    .sort((a, b) => a - b);
  if (!positions.length) return { edge, offset: 0.5 };
  const boundaries = [0.08, ...positions, 0.92];
  let largestGap = { start: boundaries[0], end: boundaries[1] };
  for (let index = 1; index < boundaries.length - 1; index += 1) {
    const gap = { start: boundaries[index], end: boundaries[index + 1] };
    if (gap.end - gap.start > largestGap.end - largestGap.start) largestGap = gap;
  }
  return { edge, offset: (largestGap.start + largestGap.end) / 2 };
};

function ColorProperty({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (color: string) => void;
}) {
  const ariaLabel = `${label}十六进制`;
  return (
    <label className="field color-field">
      <span>{label}</span>
      <div className="property-color-control">
        <input
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
        <input
          key={color}
          className="color-hex-input"
          defaultValue={color.toUpperCase()}
          aria-label={ariaLabel}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim();
            const nextColor = raw.startsWith("#") ? raw : `#${raw}`;
            if (/^#[0-9a-fA-F]{6}$/.test(nextColor)) {
              onChange(nextColor.toLowerCase());
            } else {
              event.currentTarget.value = color.toUpperCase();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
    </label>
  );
}

function App() {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: createSampleDocument(),
    future: [],
  }));
  const document = history.present;
  const portGap = getDocumentPortGap(document);
  const [viewport, setViewport] = useState<Viewport>({ x: 28, y: 35, zoom: 0.62 });
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [query, setQuery] = useState("");
  const [editingPort, setEditingPort] = useState<EditingPort | null>(null);
  const [elementDrag, setElementDrag] = useState<ElementDrag | null>(null);
  const [marqueeDrag, setMarqueeDrag] = useState<MarqueeDrag | null>(null);
  const [panDrag, setPanDrag] = useState<PanDrag | null>(null);
  const [networkPointDrag, setNetworkPointDrag] = useState<NetworkPointDrag | null>(null);
  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuides | null>(null);
  const [portReposition, setPortReposition] = useState<PortReposition | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryWidth, setLibraryWidth] = useState(readStoredLibraryWidth);
  const [libraryCollapsed, setLibraryCollapsed] = useState(readStoredLibraryCollapsed);
  const [libraryResize, setLibraryResize] = useState<LibraryResize | null>(null);
  const [notice, setNotice] = useState("示例工程已载入");
  const canvasRef = useRef<HTMLDivElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const portPressRef = useRef<PortPress | null>(null);
  const initialFitDone = useRef(false);

  const selectedElement = useMemo(
    () =>
      selection?.kind === "element"
        ? document.elements.find((element) => element.id === selection.id)
        : undefined,
    [document.elements, selection],
  );
  const selectedElementIds = useMemo(() => {
    if (selection?.kind === "elements") return selection.ids;
    return selection?.kind === "element" ? [selection.id] : [];
  }, [selection]);
  const selectedNetwork = useMemo(
    () =>
      selection?.kind === "network"
        ? document.networks.find((network) => network.id === selection.id)
        : undefined,
    [document.networks, selection],
  );
  const selectedBranch = useMemo(() => {
    if (selection?.kind !== "branch") return undefined;
    const network = document.networks.find((item) => item.id === selection.networkId);
    const endpoint = getPort(document, selection.memberRef);
    if (!network || !endpoint) return undefined;
    return { network, memberRef: selection.memberRef, ...endpoint };
  }, [document, selection]);
  const selectedBranchColor = selectedBranch
    ? selectedBranch.network.branchColors?.[selectedBranch.memberRef] ?? selectedBranch.network.color
    : undefined;

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_WIDTH_KEY, String(libraryWidth));
  }, [libraryWidth]);

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_COLLAPSED_KEY, String(libraryCollapsed));
  }, [libraryCollapsed]);

  useEffect(() => {
    if (!wireDraft && !networkPointDrag) setSnapGuides(null);
  }, [networkPointDrag, wireDraft]);

  useEffect(() => {
    if (!libraryResize) return;
    const body = window.document.body;
    const previousCursor = body.style.cursor;
    const previousUserSelect = body.style.userSelect;
    body.style.cursor = "col-resize";
    body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== libraryResize.pointerId) return;
      setLibraryWidth(clampLibraryWidth(
        libraryResize.startWidth + event.clientX - libraryResize.startX,
      ));
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === libraryResize.pointerId) setLibraryResize(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      body.style.cursor = previousCursor;
      body.style.userSelect = previousUserSelect;
    };
  }, [libraryResize]);

  const commit = useCallback((updater: (current: SanwDocument) => SanwDocument) => {
    setHistory((current) => {
      const updated = updater(current.present);
      if (updated === current.present) return current;
      const next = markUpdated(updated);
      return {
        past: [...current.past.slice(-79), current.present],
        present: next,
        future: [],
      };
    });
  }, []);

  const cancelPortInteraction = useCallback((restoreDocument = false) => {
    const press = portPressRef.current;
    if (!press) return;
    portPressRef.current = null;
    if (restoreDocument && press.activated && press.moved) {
      setHistory((current) => ({ ...current, present: press.startDocument }));
    }
    setPortReposition(null);
  }, []);

  useEffect(() => () => {
    portPressRef.current = null;
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return { x: 0, y: 0 };
      return {
        x: (clientX - bounds.left - viewport.x) / viewport.zoom,
        y: (clientY - bounds.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  const handleNativeWheel = useCallback((event: globalThis.WheelEvent) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    const unit = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? bounds.height
        : 1;

    if (event.ctrlKey || event.metaKey) {
      const local = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const delta = Math.max(-60, Math.min(60, event.deltaY * unit));
      setViewport((current) => {
        const world = {
          x: (local.x - current.x) / current.zoom,
          y: (local.y - current.y) / current.zoom,
        };
        const zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, current.zoom * Math.exp(-delta * 0.006)),
        );
        return {
          zoom,
          x: local.x - world.x * zoom,
          y: local.y - world.y * zoom,
        };
      });
      return;
    }

    setViewport((current) => ({
      ...current,
      x: current.x - event.deltaX * unit,
      y: current.y - event.deltaY * unit,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleNativeWheel);
  }, [handleNativeWheel]);

  const centerOfViewport = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 700, y: 500 };
    return clientToWorld(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }, [clientToWorld]);

  const fitView = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const content = documentBounds(document.elements, portGap + 64);
    const padding = 90;
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(
        1,
        (bounds.width - padding * 2) / content.width,
        (bounds.height - padding * 2) / content.height,
      ),
    );
    setViewport({
      zoom,
      x: bounds.width / 2 - (content.x + content.width / 2) * zoom,
      y: bounds.height / 2 - (content.y + content.height / 2) * zoom,
    });
  }, [document.elements, portGap]);

  useEffect(() => {
    if (initialFitDone.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (initialFitDone.current) return;
      initialFitDone.current = true;
      fitView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView]);

  const addTemplate = useCallback(
    (templateId: string, at?: Point) => {
      const template = templateById(templateId);
      if (!template) return;
      const point = at ?? centerOfViewport();
      const instance = instantiateTemplate(
        template,
        point.x - template.width / 2,
        point.y - template.height / 2,
      );
      commit((current) => ({ ...current, elements: [...current.elements, instance] }));
      setSelection({ kind: "element", id: instance.id });
      setTool("select");
      setNotice(`已添加 ${template.name}`);
    },
    [centerOfViewport, commit],
  );

  const addText = useCallback(
    (point: Point) => {
      const element: TextElement = {
        id: createId("text"),
        kind: "text",
        text: "双击或在右侧修改文字",
        x: point.x,
        y: point.y,
        width: 280,
        height: 50,
        zIndex: 20,
        fontSize: 22,
        color: "#223047",
        weight: 600,
      };
      commit((current) => ({ ...current, elements: [...current.elements, element] }));
      setSelection({ kind: "element", id: element.id });
      setTool("select");
    },
    [commit],
  );

  const addImageFile = useCallback(
    async (file: File, point?: Point) => {
      if (!file.type.startsWith("image/")) return;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({ width: 640, height: 420 });
        image.src = dataUrl;
      });
      const scale = Math.min(1, 480 / dimensions.width);
      const width = Math.max(120, dimensions.width * scale);
      const height = Math.max(90, dimensions.height * scale);
      const assetId = createId("asset");
      const at = point ?? centerOfViewport();
      const element: ImageElement = {
        id: createId("image"),
        kind: "image",
        assetId,
        alt: file.name,
        x: at.x - width / 2,
        y: at.y - height / 2,
        width,
        height,
        zIndex: 5,
      };
      commit((current) => ({
        ...current,
        elements: [...current.elements, element],
        assets: {
          ...current.assets,
          [assetId]: { id: assetId, name: file.name, mimeType: file.type || "image/png", dataUrl },
        },
      }));
      setSelection({ kind: "element", id: element.id });
      setTool("select");
      setNotice(`图片 ${file.name} 已加入工程`);
    },
    [centerOfViewport, commit],
  );

  const saveProject = useCallback(async () => {
    try {
      const bytes = exportSanwdraw(document);
      const fileName = `${safeFileName(document.name)}.sanwdraw`;
      if (isTauri()) {
        const path = await saveDialog({
          defaultPath: fileName,
          filters: [{ name: "SanwDraw 工程", extensions: ["sanwdraw"] }],
        });
        if (!path) return;
        await writeFile(path, bytes);
        setNotice(`已保存 ${fileName}`);
        return;
      }
      const blob = new Blob([bytes], { type: "application/x-sanwdraw" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("已导出 .sanwdraw 工程");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工程保存失败");
    }
  }, [document]);

  const openProject = useCallback(async (file: File) => {
    try {
      const next = await importSanwdraw(file);
      cancelPortInteraction();
      initialFitDone.current = false;
      setHistory({ past: [], present: next, future: [] });
      setSelection(null);
      setMarqueeDrag(null);
      setWireDraft(null);
      setNotice(`已打开 ${file.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工程文件打开失败");
    }
  }, [cancelPortInteraction]);

  const chooseProject = useCallback(async () => {
    if (!isTauri()) {
      projectInputRef.current?.click();
      return;
    }
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "SanwDraw 工程", extensions: ["sanwdraw"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const bytes = await readFile(selected);
      const fileName = selected.split(/[\\/]/).pop() ?? "工程.sanwdraw";
      await openProject(
        new File([bytes], fileName, { type: "application/x-sanwdraw" }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工程文件打开失败");
    }
  }, [openProject]);

  const removeSelection = useCallback(() => {
    if (!selection) return;
    commit((current) => {
      if (selection.kind === "elements") {
        const removedIds = new Set(selection.ids);
        return {
          ...current,
          elements: current.elements.filter((element) => !removedIds.has(element.id)),
          networks: current.networks
            .map((network) => {
              const memberIds = network.memberIds.filter((ref) => {
                const separator = ref.indexOf(":");
                return separator < 0 || !removedIds.has(ref.slice(0, separator));
              });
              const routes = Object.fromEntries(
                Object.entries(network.routes ?? {}).filter(([ref]) => memberIds.includes(ref)),
              );
              const branchColors = Object.fromEntries(
                Object.entries(network.branchColors ?? {}).filter(([ref]) => memberIds.includes(ref)),
              );
              return {
                ...network,
                memberIds,
                routes: Object.keys(routes).length ? routes : undefined,
                branchColors: Object.keys(branchColors).length ? branchColors : undefined,
              };
            })
            .filter((network) => network.memberIds.length >= 2),
        };
      }
      if (selection.kind === "network") {
        return { ...current, networks: current.networks.filter((network) => network.id !== selection.id) };
      }
      if (selection.kind === "branch") {
        const network = current.networks.find((item) => item.id === selection.networkId);
        if (!network?.memberIds.includes(selection.memberRef)) return current;
        const nextNetwork = disconnectNetworkBranch(network, selection.memberRef);
        return {
          ...current,
          networks: nextNetwork
            ? current.networks.map((item) => item.id === selection.networkId ? nextNetwork : item)
            : current.networks.filter((item) => item.id !== selection.networkId),
        };
      }
      const element = current.elements.find((item) => item.id === selection.id);
      if (!element) return current;
      const removedPrefix = `${element.id}:`;
      return {
        ...current,
        elements: current.elements.filter((item) => item.id !== selection.id),
        networks: current.networks
          .map((network) => {
            const memberIds = network.memberIds.filter((ref) => !ref.startsWith(removedPrefix));
            const routes = Object.fromEntries(
              Object.entries(network.routes ?? {}).filter(([ref]) => memberIds.includes(ref)),
            );
            const branchColors = Object.fromEntries(
              Object.entries(network.branchColors ?? {}).filter(([ref]) => memberIds.includes(ref)),
            );
            return {
              ...network,
              memberIds,
              routes: Object.keys(routes).length ? routes : undefined,
              branchColors: Object.keys(branchColors).length ? branchColors : undefined,
            };
          })
          .filter((network) => network.memberIds.length >= 2),
      };
    });
    if (selection.kind === "elements") {
      setNotice(`已删除 ${selection.ids.length} 个对象`);
    } else if (selection.kind === "branch") {
      setNotice("已断开所选支路，母线的其他连接保持不变");
    } else if (selection.kind === "network") {
      setNotice("已删除整条母线");
    }
    setSelection(null);
  }, [commit, selection]);

  const connectPortToNetwork = useCallback(
    (sourceRef: string, networkId: string) => {
      commit((current) => {
        const target = current.networks.find((network) => network.id === networkId);
        if (!target || target.memberIds.includes(sourceRef)) return current;
        const sourceNetwork = current.networks.find((network) => network.memberIds.includes(sourceRef));
        if (!sourceNetwork) {
          return {
            ...current,
            networks: current.networks.map((network) =>
              network.id === target.id
                ? { ...network, memberIds: [...network.memberIds, sourceRef] }
                : network,
            ),
          };
        }
        if (sourceNetwork.id === target.id) return current;
        return {
          ...current,
          networks: current.networks
            .filter((network) => network.id !== sourceNetwork.id)
            .map((network) =>
              network.id === target.id
                ? {
                    ...network,
                    memberIds: [...new Set([...network.memberIds, ...sourceNetwork.memberIds])],
                    routes: { ...network.routes, ...sourceNetwork.routes },
                    branchColors: { ...network.branchColors, ...sourceNetwork.branchColors },
                  }
                : network,
            ),
        };
      });
      setWireDraft(null);
      setTool("select");
      setSelection({ kind: "network", id: networkId });
      setNotice("接口已吸附到共享网络");
    },
    [commit],
  );

  const connectPorts = useCallback(
    (sourceRef: string, targetRef: string) => {
      if (sourceRef === targetRef) {
        setWireDraft(null);
        return;
      }
      const sourceNetworkAtCall = document.networks.find((network) =>
        network.memberIds.includes(sourceRef),
      );
      const targetNetworkAtCall = document.networks.find((network) =>
        network.memberIds.includes(targetRef),
      );
      const createdNetworkId = createId("network");
      const selectedNetworkId =
        sourceNetworkAtCall?.id ?? targetNetworkAtCall?.id ?? createdNetworkId;
      commit((current) => {
        const sourceNetwork = current.networks.find((network) => network.memberIds.includes(sourceRef));
        const targetNetwork = current.networks.find((network) => network.memberIds.includes(targetRef));
        if (sourceNetwork && targetNetwork?.id === sourceNetwork.id) {
          return current;
        }
        if (sourceNetwork && targetNetwork) {
          return {
            ...current,
            networks: current.networks
              .filter((network) => network.id !== targetNetwork.id)
              .map((network) =>
                network.id === sourceNetwork.id
                  ? {
                      ...network,
                      memberIds: [...new Set([...network.memberIds, ...targetNetwork.memberIds])],
                      routes: { ...network.routes, ...targetNetwork.routes },
                      branchColors: { ...network.branchColors, ...targetNetwork.branchColors },
                    }
                  : network,
              ),
          };
        }
        if (sourceNetwork || targetNetwork) {
          const existing = sourceNetwork ?? targetNetwork!;
          const newMember = sourceNetwork ? targetRef : sourceRef;
          return {
            ...current,
            networks: current.networks.map((network) =>
              network.id === existing.id
                ? { ...network, memberIds: [...new Set([...network.memberIds, newMember])] }
                : network,
            ),
          };
        }
        const source = getPort(current, sourceRef);
        const network: Network = {
          id: createdNetworkId,
          name: `${source?.port.protocol ?? source?.port.voltage ?? source?.port.current ?? "新建"} 网络`,
          domain: source?.port.domain ?? "signal",
          protocol: source?.port.protocol,
          memberIds: [sourceRef, targetRef],
          color: colorForProtocol(source?.port.domain ?? "signal", source?.port.protocol),
        };
        return { ...current, networks: [...current.networks, network] };
      });
      setWireDraft(null);
      setTool("select");
      setSelection({ kind: "network", id: selectedNetworkId });
      setNotice("连接已建立");
    },
    [commit, document.networks],
  );

  const activatePortConnection = (componentId: string, portId: string) => {
    const ref = portRef(componentId, portId);
    if (wireDraft) {
      connectPorts(wireDraft.sourceRef, ref);
      return;
    }
    const endpoint = getPort(document, ref);
    if (!endpoint) return;
    setTool("wire");
    setWireDraft({
      sourceRef: ref,
      cursor: getPortPoint(endpoint.component, endpoint.port, portGap),
    });
    setSelection({ kind: "element", id: componentId });
    setEditingPort({ componentId, portId });
    setNotice("点击另一个接口或已有连线；靠近水平/垂直方向会吸附，按住 Alt 可临时关闭");
  };

  const handlePortContactPointerDown = (
    event: ReactPointerEvent<HTMLSpanElement>,
    component: ComponentElement,
    portId: string,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    activatePortConnection(component.id, portId);
  };

  const handlePortPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    component: ComponentElement,
    portId: string,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const port = component.ports.find((item) => item.id === portId);
    if (!port) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (wireDraft) {
      setWireDraft(null);
      setTool("select");
      setSnapGuides(null);
      setNotice("已取消连线；接口已选中，可继续编辑或拖动位置");
    }
    setSelection({ kind: "element", id: component.id });
    setEditingPort({ componentId: component.id, portId });
    const press: PortPress = {
      pointerId: event.pointerId,
      componentId: component.id,
      portId,
      originEdge: port.edge,
      startClient: { x: event.clientX, y: event.clientY },
      startDocument: document,
      activated: false,
      moved: false,
    };
    portPressRef.current = press;
  };

  const startElementDrag = (event: ReactPointerEvent, element: CanvasElement) => {
    if (tool !== "select" || element.locked) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = clientToWorld(event.clientX, event.clientY);
    const elementIds = selection?.kind === "elements" && selection.ids.includes(element.id)
      ? selection.ids
      : [element.id];
    const elementOrigins = Object.fromEntries(
      elementIds.flatMap((id) => {
        const item = document.elements.find((candidate) => candidate.id === id);
        return item ? [[id, { x: item.x, y: item.y }]] : [];
      }),
    );
    setElementDrag({
      pointerId: event.pointerId,
      elementIds,
      origin,
      elementOrigins,
      startDocument: document,
    });
    if (elementIds.length === 1) setSelection({ kind: "element", id: element.id });
  };

  const startRoutePointDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    network: Network,
    memberRef: string,
    pointIndex: number,
    routePoints: Point[],
  ) => {
    if (tool !== "select") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const savedPoints = routePoints.map((point) => ({ ...point }));
    setHistory((current) => ({
      ...current,
      present: {
        ...current.present,
        networks: current.present.networks.map((item) =>
          item.id === network.id
            ? { ...item, routes: { ...item.routes, [memberRef]: savedPoints } }
            : item,
        ),
      },
    }));
    setNetworkPointDrag({
      kind: "route",
      pointerId: event.pointerId,
      networkId: network.id,
      memberRef,
      pointIndex,
      startDocument: document,
    });
    setSelection({ kind: "branch", networkId: network.id, memberRef });
    setNotice("拖动拐点调整走线；靠近水平或垂直方向会自动吸附，按住 Alt 可自由拖动");
  };

  const startJunctionDrag = (
    event: ReactPointerEvent<SVGRectElement>,
    network: Network,
  ) => {
    if (tool !== "select") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setNetworkPointDrag({
      kind: "junction",
      pointerId: event.pointerId,
      networkId: network.id,
      startDocument: document,
    });
    setSelection({ kind: "network", id: network.id });
    setNotice("拖动汇合点调整共享网络位置；靠近水平或垂直方向会自动吸附");
  };

  const addRoutePoint = (
    event: ReactMouseEvent<SVGPathElement>,
    network: Network,
    memberRef: string,
    start: Point,
    edge: ComponentElement["ports"][number]["edge"],
    hub: Point,
  ) => {
    if (wireDraft || tool !== "select") return;
    event.stopPropagation();
    const pointer = clientToWorld(event.clientX, event.clientY);
    const routePoints = (network.routes?.[memberRef] ?? defaultRoutePointsToHub(start, edge, hub))
      .map((item) => ({ ...item }));
    const projection = nearestPointOnPath([start, ...routePoints, hub], pointer);
    routePoints.splice(projection.segmentIndex, 0, projection.point);
    commit((current) => ({
      ...current,
      networks: current.networks.map((item) =>
        item.id === network.id
          ? { ...item, routes: { ...item.routes, [memberRef]: routePoints } }
          : item,
      ),
    }));
    setSelection({ kind: "branch", networkId: network.id, memberRef });
    setNotice("已新增拐点；拖动圆点即可调整");
  };

  const removeRoutePoint = (
    event: ReactMouseEvent<SVGCircleElement>,
    network: Network,
    memberRef: string,
    pointIndex: number,
    routePoints: Point[],
  ) => {
    event.stopPropagation();
    const nextPoints = routePoints.filter((_, index) => index !== pointIndex);
    commit((current) => ({
      ...current,
      networks: current.networks.map((item) =>
        item.id === network.id
          ? { ...item, routes: { ...item.routes, [memberRef]: nextPoints } }
          : item,
      ),
    }));
    setSelection({ kind: "branch", networkId: network.id, memberRef });
    setNotice("已删除拐点");
  };

  const resetNetworkRouting = useCallback(
    (networkId: string) => {
      commit((current) => ({
        ...current,
        networks: current.networks.map((network) => {
          if (network.id !== networkId) return network;
          const automaticNetwork = { ...network };
          delete automaticNetwork.routes;
          delete automaticNetwork.junction;
          return automaticNetwork;
        }),
      }));
      setNotice("已恢复自动走线");
    },
    [commit],
  );

  const resetBranchRouting = useCallback(
    (networkId: string, memberRef: string) => {
      commit((current) => ({
        ...current,
        networks: current.networks.map((network) => {
          if (network.id !== networkId || !network.routes?.[memberRef]) return network;
          const routes = { ...network.routes };
          delete routes[memberRef];
          return { ...network, routes: Object.keys(routes).length ? routes : undefined };
        }),
      }));
      setNotice("所选支路已恢复自动走线");
    },
    [commit],
  );

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const world = clientToWorld(event.clientX, event.clientY);
    if (tool === "hand" || event.button === 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanDrag({
        pointerId: event.pointerId,
        clientOrigin: { x: event.clientX, y: event.clientY },
        viewportOrigin: { x: viewport.x, y: viewport.y },
      });
      return;
    }
    if (event.button !== 0) return;
    if (tool === "text") {
      addText(world);
      return;
    }
    if (wireDraft) {
      setWireDraft(null);
      setNotice("已取消连线");
    }
    if (tool === "select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      const baseIds = event.shiftKey ? selectedElementIds : [];
      setMarqueeDrag({
        pointerId: event.pointerId,
        origin: world,
        current: world,
        hitIds: baseIds,
        additive: event.shiftKey,
        baseIds,
      });
      return;
    }
    setSelection(null);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const portPress = portPressRef.current;
    if (portPress?.pointerId === event.pointerId) {
      if (!portPress.activated) {
        const distance = Math.hypot(
          event.clientX - portPress.startClient.x,
          event.clientY - portPress.startClient.y,
        );
        if (distance <= PORT_PRESS_MOVE_TOLERANCE) return;
        portPress.activated = true;
        setPortReposition({ componentId: portPress.componentId, portId: portPress.portId });
        setNotice("拖动接口框调整位置；相邻接口会自动避让，松手后所在边保持等距");
      }

      const component = document.elements.find(
        (element): element is ComponentElement =>
          element.kind === "component" && element.id === portPress.componentId,
      );
      if (!component) return;
      const world = clientToWorld(event.clientX, event.clientY);
      const placement = nearestComponentEdgePlacement(component, world);
      const currentPort = component.ports.find((port) => port.id === portPress.portId);
      if (!currentPort) return;
      if (currentPort.edge !== placement.edge || Math.abs(currentPort.offset - placement.offset) > 0.001) {
        portPress.moved = true;
        setHistory((current) => ({
          ...current,
          present: {
            ...current.present,
            elements: current.present.elements.map((element) =>
              element.kind === "component" && element.id === portPress.componentId
                ? {
                    ...element,
                    ports: movePortWithNeighbours(element, portPress.portId, placement, portPress.originEdge),
                  }
                : element,
            ),
          },
        }));
      }
      return;
    }

    if (marqueeDrag?.pointerId === event.pointerId) {
      const current = clientToWorld(event.clientX, event.clientY);
      const rect = normalizeRect(marqueeDrag.origin, current);
      const hitIds = [
        ...new Set([
          ...marqueeDrag.baseIds,
          ...document.elements
            .filter((element) => elementIntersectsRect(element, rect))
            .map((element) => element.id),
        ]),
      ];
      setMarqueeDrag((active) => active?.pointerId === event.pointerId
        ? { ...active, current, hitIds }
        : active);
      return;
    }

    if (panDrag?.pointerId === event.pointerId) {
      setViewport((current) => ({
        ...current,
        x: panDrag.viewportOrigin.x + event.clientX - panDrag.clientOrigin.x,
        y: panDrag.viewportOrigin.y + event.clientY - panDrag.clientOrigin.y,
      }));
      return;
    }
    const world = clientToWorld(event.clientX, event.clientY);
    if (networkPointDrag?.pointerId === event.pointerId) {
      let dragPoint = world;
      let nextGuides: SnapGuides | null = null;
      if (!event.altKey) {
        const network = document.networks.find((item) => item.id === networkPointDrag.networkId);
        if (network) {
          const endpoints = getNetworkPoints(document, network);
          let anchors: Point[] = [];
          if (networkPointDrag.kind === "route") {
            const endpoint = endpoints.find((item) => item.ref === networkPointDrag.memberRef);
            const hub = networkHub(document, network);
            if (endpoint) {
              const routePoints = network.routes?.[networkPointDrag.memberRef]
                ?? defaultRoutePointsToHub(endpoint.point, endpoint.edge, hub);
              const previous = networkPointDrag.pointIndex === 0
                ? endpoint.point
                : routePoints[networkPointDrag.pointIndex - 1];
              const next = networkPointDrag.pointIndex === routePoints.length - 1
                ? hub
                : routePoints[networkPointDrag.pointIndex + 1];
              anchors = [previous, next].filter((point): point is Point => Boolean(point));
            }
          } else {
            anchors = endpoints.flatMap((endpoint) => {
              const routePoints = network.routes?.[endpoint.ref];
              const routeTail = routePoints?.[routePoints.length - 1];
              return routeTail ? [endpoint.point, routeTail] : [endpoint.point];
            });
          }
          const snapped = snapPointToOrthogonalAnchors(
            world,
            anchors,
            ORTHOGONAL_SNAP_SCREEN_DISTANCE / viewport.zoom,
          );
          dragPoint = snapped.point;
          nextGuides = snapped.snappedX !== undefined || snapped.snappedY !== undefined
            ? { x: snapped.snappedX, y: snapped.snappedY }
            : null;
        }
      }
      setSnapGuides(nextGuides);
      setHistory((current) => ({
        ...current,
        present: {
          ...current.present,
          networks: current.present.networks.map((network) => {
            if (network.id !== networkPointDrag.networkId) return network;
            if (networkPointDrag.kind === "junction") {
              return { ...network, junction: dragPoint };
            }
            const routePoints = network.routes?.[networkPointDrag.memberRef] ?? [];
            return {
              ...network,
              routes: {
                ...network.routes,
                [networkPointDrag.memberRef]: routePoints.map((point, index) =>
                  index === networkPointDrag.pointIndex ? dragPoint : point,
                ),
              },
            };
          }),
        },
      }));
      return;
    }
    if (elementDrag?.pointerId === event.pointerId) {
      const dx = world.x - elementDrag.origin.x;
      const dy = world.y - elementDrag.origin.y;
      setHistory((current) => ({
        ...current,
        present: {
          ...current.present,
          elements: current.present.elements.map((element) =>
            elementDrag.elementIds.includes(element.id)
              ? {
                  ...element,
                  x: (elementDrag.elementOrigins[element.id]?.x ?? element.x) + dx,
                  y: (elementDrag.elementOrigins[element.id]?.y ?? element.y) + dy,
                }
              : element,
          ),
        },
      }));
    }
    if (wireDraft) {
      let cursor = world;
      let nextGuides: SnapGuides | null = null;
      const source = getPort(document, wireDraft.sourceRef);
      if (source && !event.altKey) {
        const sourcePoint = getPortPoint(source.component, source.port, portGap);
        const snapped = snapPointToOrthogonalAnchors(
          world,
          [sourcePoint],
          ORTHOGONAL_SNAP_SCREEN_DISTANCE / viewport.zoom,
        );
        cursor = snapped.point;
        nextGuides = snapped.snappedX !== undefined || snapped.snappedY !== undefined
          ? { x: snapped.snappedX, y: snapped.snappedY }
          : null;
      }
      setSnapGuides(nextGuides);
      setWireDraft({ ...wireDraft, cursor });
    } else if (snapGuides) {
      setSnapGuides(null);
    }
  };

  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const portPress = portPressRef.current;
    if (portPress?.pointerId === event.pointerId) {
      portPressRef.current = null;
      const cancelled = event.type === "pointercancel";
      if (cancelled && portPress.activated && portPress.moved) {
        setHistory((current) => ({ ...current, present: portPress.startDocument }));
      } else if (portPress.activated && portPress.moved) {
        setHistory((current) => {
          const startComponent = portPress.startDocument.elements.find(
            (element): element is ComponentElement =>
              element.kind === "component" && element.id === portPress.componentId,
          );
          let reroutedRefs: string[] = [];
          const elements = current.present.elements.map((element) => {
            if (element.kind !== "component" || element.id !== portPress.componentId) return element;
            const movedPort = element.ports.find((port) => port.id === portPress.portId);
            if (!movedPort) return element;
            const ports = element.ports;
            if (startComponent) {
              reroutedRefs = changedPortRefs(element.id, startComponent.ports, ports);
            }
            return { ...element, ports };
          });
          return {
            past: [...current.past.slice(-79), portPress.startDocument],
            present: markUpdated({
              ...current.present,
              elements,
              networks: resetNetworkRoutesForMembers(current.present.networks, reroutedRefs),
            }),
            future: [],
          };
        });
        setNotice("接口位置已更新；所在边的接口已自动等距分布");
      } else if (!portPress.activated && !cancelled) {
        setSelection({ kind: "element", id: portPress.componentId });
        setEditingPort({ componentId: portPress.componentId, portId: portPress.portId });
        setNotice("已选中接口，可在右侧编辑信息或拖动接口框调整位置");
      }
      setPortReposition(null);
      return;
    }

    if (marqueeDrag?.pointerId === event.pointerId) {
      setMarqueeDrag(null);
      if (event.type === "pointercancel") return;
      const rect = normalizeRect(marqueeDrag.origin, marqueeDrag.current);
      if (rect.width < 4 && rect.height < 4) {
        if (!marqueeDrag.additive) setSelection(null);
        return;
      }
      if (!marqueeDrag.hitIds.length) {
        setSelection(null);
        setNotice("框选范围内没有对象");
      } else if (marqueeDrag.hitIds.length === 1) {
        setSelection({ kind: "element", id: marqueeDrag.hitIds[0] });
        setNotice("已选中 1 个对象");
      } else {
        setSelection({ kind: "elements", ids: marqueeDrag.hitIds });
        setNotice(`已框选 ${marqueeDrag.hitIds.length} 个对象；拖动任意对象可整体移动`);
      }
      return;
    }

    if (networkPointDrag?.pointerId === event.pointerId) {
      setHistory((current) => ({
        past: [...current.past.slice(-79), networkPointDrag.startDocument],
        present: markUpdated(current.present),
        future: [],
      }));
      setNetworkPointDrag(null);
      setSnapGuides(null);
    }
    if (elementDrag?.pointerId === event.pointerId) {
      setHistory((current) => ({
        past: [...current.past.slice(-79), elementDrag.startDocument],
        present: markUpdated(current.present),
        future: [],
      }));
      setElementDrag(null);
    }
    if (panDrag?.pointerId === event.pointerId) setPanDrag(null);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const point = clientToWorld(event.clientX, event.clientY);
    const templateId = event.dataTransfer.getData("application/x-sanwdraw-template");
    if (templateId) {
      addTemplate(templateId, point);
      return;
    }
    const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/"));
    if (image) await addImageFile(image, point);
  };

  const updateElement = useCallback(
    (id: string, patch: Partial<CanvasElement>) => {
      commit((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as CanvasElement) : element,
        ),
      }));
    },
    [commit],
  );

  const addComponentPort = useCallback(
    (component: ComponentElement) => {
      const placement = nextPortPlacement(component.ports);
      const newPort: InterfacePort = {
        id: createId("port"),
        name: "新端口",
        domain: "signal",
        edge: placement.edge,
        offset: placement.offset,
        protocol: "GPIO",
      };
      commit((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === component.id && element.kind === "component"
            ? { ...element, ports: [...element.ports, newPort] }
            : element,
        ),
      }));
      setEditingPort({ componentId: component.id, portId: newPort.id });
      setNotice("已添加端口，可在右侧编辑名称、类型和位置");
    },
    [commit],
  );

  const updateComponentPort = useCallback(
    (componentId: string, portId: string, patch: Partial<InterfacePort>) => {
      commit((current) => {
        let endpointMoved = false;
        const elements = current.elements.map((element) => {
          if (element.id !== componentId || element.kind !== "component") return element;
          return {
            ...element,
            ports: element.ports.map((port) => {
              if (port.id !== portId) return port;
              const next = { ...port, ...patch };
              endpointMoved = port.edge !== next.edge || Math.abs(port.offset - next.offset) > 0.0001;
              return next;
            }),
          };
        });
        return {
          ...current,
          elements,
          networks: endpointMoved
            ? resetNetworkRoutesForMembers(current.networks, [portRef(componentId, portId)])
            : current.networks,
        };
      });
    },
    [commit],
  );

  const moveComponentPortEdge = useCallback(
    (componentId: string, portId: string, edge: PortEdge) => {
      commit((current) => {
        let changed = false;
        let reroutedRefs: string[] = [];
        const elements = current.elements.map((element) => {
          if (element.id !== componentId || element.kind !== "component") return element;
          const ports = movePortToEdge(element.ports, portId, edge);
          if (ports === element.ports) return element;
          changed = true;
          reroutedRefs = changedPortRefs(componentId, element.ports, ports);
          return { ...element, ports };
        });
        return changed
          ? {
              ...current,
              elements,
              networks: resetNetworkRoutesForMembers(current.networks, reroutedRefs),
            }
          : current;
      });
      setNotice(`接口已移到${portEdgeLabels[edge]}，两侧接口已自动等距分布`);
    },
    [commit],
  );

  const removeComponentPort = useCallback(
    (componentId: string, portId: string) => {
      const removedRef = portRef(componentId, portId);
      commit((current) => {
        let reroutedRefs: string[] = [];
        const elements = current.elements.map((element) => {
          if (element.id !== componentId || element.kind !== "component") return element;
          const removed = element.ports.find((port) => port.id === portId);
          const remaining = element.ports.filter((port) => port.id !== portId);
          const ports = removed
            ? distributePortsOnEdges(remaining, [removed.edge])
            : remaining;
          reroutedRefs = changedPortRefs(componentId, element.ports, ports);
          return { ...element, ports };
        });
        const connectedNetworks = current.networks.flatMap((network) => {
          if (!network.memberIds.includes(removedRef)) return [network];
          const nextNetwork = disconnectNetworkBranch(network, removedRef);
          return nextNetwork ? [nextNetwork] : [];
        });
        return {
          ...current,
          elements,
          networks: resetNetworkRoutesForMembers(connectedNetworks, reroutedRefs),
        };
      });
      setEditingPort((current) =>
        current?.componentId === componentId && current.portId === portId ? null : current,
      );
      setWireDraft((current) => current?.sourceRef === removedRef ? null : current);
      setNotice("已删除端口；对应母线支路已断开，其他支路保持不变");
    },
    [commit],
  );

  const updateNetwork = useCallback(
    (id: string, patch: Partial<Network>) => {
      commit((current) => ({
        ...current,
        networks: current.networks.map((network) =>
          network.id === id ? { ...network, ...patch } : network,
        ),
      }));
    },
    [commit],
  );

  const updateBranchColor = useCallback(
    (networkId: string, memberRef: string, color?: string) => {
      commit((current) => ({
        ...current,
        networks: current.networks.map((network) => {
          if (network.id !== networkId) return network;
          const branchColors = { ...network.branchColors };
          if (color) branchColors[memberRef] = color;
          else delete branchColors[memberRef];
          return {
            ...network,
            branchColors: Object.keys(branchColors).length ? branchColors : undefined,
          };
        }),
      }));
      setNotice(color ? "支路颜色已更新" : "支路颜色已恢复跟随母线");
    },
    [commit],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setMarqueeDrag(null);
        const ids = document.elements.map((element) => element.id);
        if (!ids.length) {
          setSelection(null);
          setNotice("画布上没有可选对象");
        } else if (ids.length === 1) {
          setSelection({ kind: "element", id: ids[0] });
          setNotice("已选择画布上的 1 个对象");
        } else {
          setSelection({ kind: "elements", ids });
          setNotice(`已选择画布上的 ${ids.length} 个对象`);
        }
        return;
      }
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (command && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void chooseProject();
        return;
      }
      if (event.key === "Escape") {
        cancelPortInteraction(true);
        setMarqueeDrag(null);
        setWireDraft(null);
        setSelection(null);
        setTool("select");
        setSettingsOpen(false);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelection();
        return;
      }
      const shortcuts: Record<string, Tool> = {
        v: "select",
        w: "wire",
        t: "text",
        h: "hand",
        i: "image",
      };
      const nextTool = shortcuts[event.key.toLowerCase()];
      if (nextTool) {
        setTool(nextTool);
        if (nextTool === "image") imageInputRef.current?.click();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelPortInteraction, chooseProject, redo, removeSelection, saveProject, undo]);

  const updatePortGap = useCallback(
    (value: number) => {
      const nextGap = clampPortGap(value);
      commit((current) => ({
        ...current,
        settings: { ...current.settings, portGap: nextGap },
      }));
      setNotice(`接口框间距已设为 ${nextGap}px`);
    },
    [commit],
  );

  const visibleTemplates = componentTemplates.filter((template) => {
    const haystack = `${template.name} ${template.resources.join(" ")}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  const setZoom = (zoom: number) =>
    setViewport((current) => ({
      ...current,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
    }));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><BrandMark size={34} /></div>
        <div className="brand-copy">
          <strong>SanwDraw</strong>
          <span>Hardware architecture canvas</span>
        </div>
        <div className="document-title-wrap">
          <span className="document-dot" />
          <input
            className="document-title"
            value={document.name}
            onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))}
            aria-label="工程名称"
          />
          <span className="file-extension">.sanwdraw</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={undo} disabled={!history.past.length} title="撤销">
            <Icon name="undo" />
          </button>
          <button className="icon-button" onClick={redo} disabled={!history.future.length} title="重做">
            <Icon name="redo" />
          </button>
          <span className="topbar-divider" />
          <button className="button secondary" onClick={() => void chooseProject()}>
            <Icon name="open" /> 打开
          </button>
          <button className="button primary" onClick={() => void saveProject()}>
            <Icon name="save" /> 保存
          </button>
        </div>
      </header>

      <div
        className={`app-main ${libraryResize ? "resizing-library" : ""}`}
        style={{
          "--library-width": `${libraryCollapsed ? 0 : libraryWidth}px`,
        } as React.CSSProperties}
      >
        <nav className="tool-rail" aria-label="画布工具">
          {toolItems.map((item) => (
            <button
              key={item.id}
              className={`tool-button ${tool === item.id ? "active" : ""}`}
              onClick={() => {
                setTool(item.id);
                if (item.id !== "wire") setWireDraft(null);
                if (item.id === "image") imageInputRef.current?.click();
              }}
              title={`${item.label} (${item.shortcut})`}
            >
              <Icon name={item.id} size={19} />
              <span>{item.label}</span>
              <kbd>{item.shortcut}</kbd>
            </button>
          ))}
          <span className="tool-rail-spacer" />
          <button
            className={`tool-button settings-button ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((current) => !current)}
            title="画布设置"
            aria-expanded={settingsOpen}
          >
            <Icon name="settings" size={19} />
            <span>设置</span>
          </button>
        </nav>

        {settingsOpen && (
          <section className="settings-popover" aria-label="画布设置">
            <div className="settings-heading">
              <div><p className="eyebrow">SETTINGS</p><h2>画布设置</h2></div>
              <button className="mini-icon" onClick={() => setSettingsOpen(false)} title="关闭设置">
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="settings-content">
              <div className="setting-label-row">
                <div>
                  <strong>接口框与主框间距</strong>
                  <span>所有接口框完整环绕在组件外侧</span>
                </div>
                <output>{portGap}px</output>
              </div>
              <div className="port-gap-preview" style={{ "--preview-gap": `${portGap}px` } as React.CSSProperties}>
                <div className="preview-component">主框</div>
                <span className="preview-port left">CAN</span>
                <span className="preview-port right">24V</span>
              </div>
              <input
                className="port-gap-slider"
                type="range"
                min={MIN_PORT_GAP}
                max={MAX_PORT_GAP}
                step="1"
                value={portGap}
                onChange={(event) => updatePortGap(Number(event.target.value))}
                aria-label="接口框与主框间距"
              />
              <div className="setting-presets">
                {[8, 16, 24, 36].map((value) => (
                  <button
                    key={value}
                    className={portGap === value ? "active" : ""}
                    onClick={() => updatePortGap(value)}
                  >
                    {value}px
                  </button>
                ))}
              </div>
              <p className="settings-note">间距会随工程保存，并同步调整连线的真实端点。</p>
            </div>
          </section>
        )}

        <aside className={`library-panel ${libraryCollapsed ? "collapsed" : ""}`} aria-hidden={libraryCollapsed}>
          {!libraryCollapsed && (
            <>
              <div className="panel-heading">
                <div><p className="eyebrow">LIBRARY</p><h2>功能组件</h2></div>
                <button className="mini-icon" title="新建组件模板"><Icon name="plus" size={16} /></button>
              </div>
              <label className="search-box">
                <Icon name="search" size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索组件或协议" />
              </label>
              <div className="library-tip">拖到画布，或单击添加到视图中心</div>
              <div className="template-list">
                {visibleTemplates.map((template) => {
                  const powerCount = template.ports.filter((port) => port.domain === "power").length;
                  const signalCount = template.ports.length - powerCount;
                  return (
                    <button
                      key={template.id}
                      draggable
                      className="template-card"
                      onClick={() => addTemplate(template.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-sanwdraw-template", template.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      <span className="template-accent" style={{ background: template.accent }} />
                      <span className="template-card-body">
                        <strong>{template.name}</strong>
                        <span className="template-counts">
                          {powerCount > 0 && <em className="count power">电源 {powerCount}</em>}
                          {signalCount > 0 && <em className="count signal">信号 {signalCount}</em>}
                        </span>
                      </span>
                      <Icon name="plus" size={15} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {!libraryCollapsed && (
          <div
            className="library-resizer"
            role="separator"
            aria-label="调整器件栏宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_LIBRARY_WIDTH}
            aria-valuemax={MAX_LIBRARY_WIDTH}
            aria-valuenow={libraryWidth}
            title="拖动调整器件栏宽度，双击恢复默认宽度"
            onPointerDown={(event) => {
              event.preventDefault();
              setLibraryResize({
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: libraryWidth,
              });
            }}
            onDoubleClick={() => {
              setLibraryWidth(DEFAULT_LIBRARY_WIDTH);
              setNotice("器件栏已恢复默认宽度");
            }}
          />
        )}
        <button
          className={`library-collapse-toggle ${libraryCollapsed ? "collapsed" : ""}`}
          onClick={() => {
            setLibraryCollapsed((current) => {
              const next = !current;
              setNotice(next ? "器件栏已收起" : "器件栏已展开");
              return next;
            });
          }}
          aria-label={libraryCollapsed ? "展开器件栏" : "收起器件栏"}
          aria-expanded={!libraryCollapsed}
          title={libraryCollapsed ? "展开器件栏" : "收起器件栏"}
        >
          <Icon name={libraryCollapsed ? "chevron-right" : "chevron-left"} size={15} />
        </button>

        <main
          ref={canvasRef}
          className={`canvas tool-${tool} ${panDrag ? "is-panning" : ""}`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div
            className="grid-layer"
            style={{
              backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
              backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            }}
          />
          <div
            className="world"
            style={{
              width: WORLD_WIDTH,
              height: WORLD_HEIGHT,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            }}
          >
            <svg className="wire-layer" width={WORLD_WIDTH} height={WORLD_HEIGHT}>
              {snapGuides?.x !== undefined && (
                <line
                  className="wire-snap-guide"
                  x1={snapGuides.x}
                  y1={0}
                  x2={snapGuides.x}
                  y2={WORLD_HEIGHT}
                />
              )}
              {snapGuides?.y !== undefined && (
                <line
                  className="wire-snap-guide"
                  x1={0}
                  y1={snapGuides.y}
                  x2={WORLD_WIDTH}
                  y2={snapGuides.y}
                />
              )}
              {document.networks.map((network) => {
                const points = getNetworkPoints(document, network);
                const hub = networkHub(document, network);
                const networkSelected = selection?.kind === "network" && selection.id === network.id;
                const selectedBranchRef = selection?.kind === "branch" && selection.networkId === network.id
                  ? selection.memberRef
                  : undefined;
                return (
                  <g key={network.id} className={networkSelected ? "network selected" : "network"}>
                    {points.map((item) => {
                      const branchSelected = selectedBranchRef === item.ref;
                      const routePoints = network.routes?.[item.ref]
                        ?? defaultRoutePointsToHub(item.point, item.edge, hub);
                      const path = routeToHub(item.point, item.edge, hub, routePoints);
                      return (
                        <g
                          key={`${network.id}-${item.ref}`}
                          className={branchSelected ? "network-branch selected" : "network-branch"}
                        >
                          <path
                            className="wire-hit-area"
                            d={path}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              if (wireDraft) connectPortToNetwork(wireDraft.sourceRef, network.id);
                              else {
                                setSelection({ kind: "branch", networkId: network.id, memberRef: item.ref });
                                setNotice("已选中一条母线支路；删除只会断开这一条线");
                              }
                            }}
                            onDoubleClick={(event) =>
                              addRoutePoint(event, network, item.ref, item.point, item.edge, hub)
                            }
                          />
                          <path
                            className="wire-path"
                            d={path}
                            style={{ stroke: network.branchColors?.[item.ref] ?? network.color }}
                          />
                          {(networkSelected || branchSelected) && routePoints.map((routePoint, pointIndex) => (
                            <circle
                              key={`${item.ref}-route-${pointIndex}`}
                              className="route-point-handle"
                              cx={routePoint.x}
                              cy={routePoint.y}
                              r={6.5 / viewport.zoom}
                              onPointerDown={(event) =>
                                startRoutePointDrag(event, network, item.ref, pointIndex, routePoints)
                              }
                              onDoubleClick={(event) =>
                                removeRoutePoint(event, network, item.ref, pointIndex, routePoints)
                              }
                            />
                          ))}
                        </g>
                      );
                    })}
                    <circle className="junction-halo" cx={hub.x} cy={hub.y} r={networkSelected ? 9 : 7} />
                    <circle
                      className="junction-dot"
                      cx={hub.x}
                      cy={hub.y}
                      r={networkSelected ? 5.2 : 4.2}
                      style={{ fill: network.color }}
                    />
                    <circle
                      className="junction-hit-area"
                      cx={hub.x}
                      cy={hub.y}
                      r={11 / viewport.zoom}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (wireDraft) connectPortToNetwork(wireDraft.sourceRef, network.id);
                        else if (tool === "select") {
                          setSelection({ kind: "network", id: network.id });
                          setNotice("已选中整条母线；删除将移除全部支路");
                        }
                      }}
                    />
                    {networkSelected && (
                      <rect
                        className="junction-drag-handle"
                        x={hub.x - 7 / viewport.zoom}
                        y={hub.y - 7 / viewport.zoom}
                        width={14 / viewport.zoom}
                        height={14 / viewport.zoom}
                        rx={3 / viewport.zoom}
                        onPointerDown={(event) => startJunctionDrag(event, network)}
                      />
                    )}
                    {points.length > 2 && (
                      <g transform={`translate(${hub.x + 12} ${hub.y - 14})`}>
                        <rect className="net-label-bg" width={Math.max(94, network.name.length * 9)} height="25" rx="8" />
                        <text className="net-label" x="10" y="17">{network.name}</text>
                      </g>
                    )}
                  </g>
                );
              })}
              {wireDraft && (() => {
                const source = getPort(document, wireDraft.sourceRef);
                if (!source) return null;
                const point = getPortPoint(source.component, source.port, portGap);
                return (
                  <path
                    className="wire-draft"
                    d={`M ${point.x} ${point.y} L ${wireDraft.cursor.x} ${wireDraft.cursor.y}`}
                    style={{ stroke: colorForProtocol(source.port.domain, source.port.protocol) }}
                  />
                );
              })()}
            </svg>

            {marqueeDrag && (() => {
              const rect = normalizeRect(marqueeDrag.origin, marqueeDrag.current);
              return (
                <div
                  className="selection-marquee"
                  style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                />
              );
            })()}

            {document.elements
              .slice()
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((element) => {
                const isSelected = selectedElementIds.includes(element.id)
                  || Boolean(marqueeDrag?.hitIds.includes(element.id));
                if (element.kind === "component") {
                  return (
                    <article
                      key={element.id}
                      className={`component-node ${isSelected ? "selected" : ""} ${portReposition?.componentId === element.id ? "port-repositioning" : ""}`}
                      style={{
                        left: element.x,
                        top: element.y,
                        width: element.width,
                        height: element.height,
                        zIndex: element.zIndex,
                        "--accent": element.accent,
                        "--port-gap": `${portGap}px`,
                      } as React.CSSProperties}
                      onPointerDown={(event) => startElementDrag(event, element)}
                    >
                      <div className="node-accent" />
                      <div className="node-header">
                        <strong>{element.name}</strong>
                        <small>{element.description}</small>
                      </div>
                      <div className="resource-list">
                        {element.resources.map((resource) => <span key={resource}>{resource}</span>)}
                      </div>
                      <div className="node-footer"><span>{element.ports.length} 个接口</span><span>v{element.templateVersion}</span></div>
                      {element.ports.map((port) => (
                        <button
                          key={port.id}
                          className={`port ${port.edge} ${port.domain} ${wireDraft?.sourceRef === portRef(element.id, port.id) ? "source" : ""} ${portReposition?.componentId === element.id && portReposition.portId === port.id ? "repositioning" : ""}`}
                          style={{
                            [port.edge === "left" || port.edge === "right" ? "top" : "left"]: `${port.offset * 100}%`,
                          } as React.CSSProperties}
                          onPointerDown={(event) => handlePortPointerDown(event, element, port.id)}
                          title={`${port.name} · ${portDetails(port)}`}
                        >
                          <span
                            className="port-dot"
                            onPointerDown={(event) => handlePortContactPointerDown(event, element, port.id)}
                            title="点击触点开始连线"
                          />
                          <span className="port-name">{port.name}</span>
                        </button>
                      ))}
                    </article>
                  );
                }
                if (element.kind === "text") {
                  return (
                    <div
                      key={element.id}
                      className={`text-element ${isSelected ? "selected" : ""}`}
                      style={{
                        left: element.x,
                        top: element.y,
                        width: element.width,
                        minHeight: element.height,
                        zIndex: element.zIndex,
                        fontSize: element.fontSize,
                        color: element.color,
                        fontWeight: element.weight,
                      }}
                      onPointerDown={(event) => startElementDrag(event, element)}
                    >
                      {element.text}
                    </div>
                  );
                }
                if (element.kind === "image") {
                  const asset = document.assets[element.assetId];
                  return (
                    <figure
                      key={element.id}
                      className={`image-element ${isSelected ? "selected" : ""}`}
                      style={{ left: element.x, top: element.y, width: element.width, height: element.height, zIndex: element.zIndex }}
                      onPointerDown={(event) => startElementDrag(event, element)}
                    >
                      {asset ? <img src={asset.dataUrl} alt={element.alt} /> : <span>图片资源缺失</span>}
                    </figure>
                  );
                }
                return (
                  <div
                    key={element.id}
                    className={`shape-element ${isSelected ? "selected" : ""}`}
                    style={{
                      left: element.x,
                      top: element.y,
                      width: element.width,
                      height: element.height,
                      zIndex: element.zIndex,
                      background: element.fill,
                      borderColor: element.stroke,
                    }}
                    onPointerDown={(event) => startElementDrag(event, element)}
                  >
                    {element.label}
                  </div>
                );
              })}
          </div>

          <div className="canvas-controls">
            <button onClick={() => setZoom(viewport.zoom - 0.1)} title="缩小" aria-label="缩小">
              <Icon name="minus" size={15} />
            </button>
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <button onClick={() => setZoom(viewport.zoom + 0.1)} title="放大" aria-label="放大">
              <Icon name="plus" size={15} />
            </button>
            <button onClick={fitView} title="适应全部内容" aria-label="适应全部内容">
              <Icon name="fit" size={16} />
            </button>
          </div>
          <div className="canvas-status">
            <span className={`status-tool ${portReposition ? "positioning" : wireDraft ? "connecting" : ""}`}>
              {portReposition ? "接口定位" : wireDraft ? "连线中" : toolItems.find((item) => item.id === tool)?.label}
            </span>
            {snapGuides && <span className="status-snap">平行 / 90° 吸附</span>}
            <span>{notice}</span>
            <span className="status-counts">
              {document.elements.filter((element) => element.kind === "component").length} 个组件 · {document.networks.length} 个网络
            </span>
          </div>
        </main>

        <aside className="inspector-panel">
          <div className="panel-heading inspector-heading">
            <div><p className="eyebrow">INSPECTOR</p><h2>属性</h2></div>
            {selection && (
              <button
                className="mini-icon danger"
                onClick={removeSelection}
                title={selection.kind === "branch" ? "断开此支路" : selection.kind === "network" ? "删除整条母线" : "删除"}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>

          {!selectedElement && !selectedNetwork && !selectedBranch && selection?.kind !== "elements" && (
            <div className="empty-inspector">
              <div className="empty-illustration"><span /><span /><span /></div>
              <strong>选择画布对象</strong>
              <p>这里会显示组件、接口、网络、文字或图片的属性。</p>
            </div>
          )}

          {selection?.kind === "elements" && (
            <div className="inspector-content">
              <div className="selection-kind"><span className="multi-kind" />多选对象</div>
              <div className="multi-selection-summary">
                <strong>已选择 {selection.ids.length} 个对象</strong>
                <p>拖动任意已选对象可整体移动，按 Delete 可一起删除。按住 Shift 可继续追加框选。</p>
              </div>
            </div>
          )}

          {selectedElement?.kind === "component" && (
            <div className="inspector-content">
              <div className="selection-kind"><span style={{ background: selectedElement.accent }} />功能组件</div>
              <label className="field">
                <span>名称</span>
                <input value={selectedElement.name} onChange={(event) => updateElement(selectedElement.id, { name: event.target.value })} />
              </label>
              <ColorProperty
                label="组件颜色"
                color={selectedElement.accent}
                onChange={(color) => updateElement(selectedElement.id, { accent: color })}
              />
              <label className="field">
                <span>描述</span>
                <textarea
                  rows={3}
                  value={selectedElement.description ?? ""}
                  placeholder="说明这个器件在系统中的用途"
                  onChange={(event) => updateElement(selectedElement.id, { description: event.target.value })}
                />
              </label>
              <div className="property-section">
                <div className="property-section-title"><strong>端口</strong><span>{selectedElement.ports.length}</span></div>
                <button className="button secondary add-port-button" onClick={() => addComponentPort(selectedElement)}>
                  <Icon name="plus" size={14} /> 添加端口
                </button>
                <div className="port-property-list">
                  {selectedElement.ports.map((port) => {
                    const editing = editingPort?.componentId === selectedElement.id && editingPort.portId === port.id;
                    return (
                      <div className={`port-property editable ${editing ? "editing" : ""}`} key={port.id}>
                        <button
                          className="port-property-summary"
                          onClick={() => setEditingPort(
                            editing ? null : { componentId: selectedElement.id, portId: port.id },
                          )}
                        >
                          <span className={`property-port-dot ${port.domain}`} />
                          <span className="port-property-copy">
                            <strong>{port.name}</strong>
                            <small>{portDetails(port)} · {portEdgeLabels[port.edge]}</small>
                          </span>
                          <em>{port.domain === "power" ? "电源" : "信号"}</em>
                        </button>
                        <button
                          className="mini-icon danger port-delete"
                          onClick={() => removeComponentPort(selectedElement.id, port.id)}
                          title={`删除端口 ${port.name}`}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                        {editing && (
                          <div className="port-editor">
                            <label className="port-editor-field full">
                              <span>端口名称</span>
                              <input
                                value={port.name}
                                onChange={(event) => updateComponentPort(selectedElement.id, port.id, { name: event.target.value })}
                              />
                            </label>
                            <label className="port-editor-field">
                              <span>类型</span>
                              <select
                                value={port.domain}
                                onChange={(event) => {
                                  const domain = event.target.value as InterfacePort["domain"];
                                  updateComponentPort(selectedElement.id, port.id, {
                                    domain,
                                    protocol: domain === "signal" ? (port.protocol ?? "GPIO") : undefined,
                                  });
                                }}
                              >
                                <option value="power">电源</option>
                                <option value="signal">信号</option>
                              </select>
                            </label>
                            <label className="port-editor-field">
                              <span>所在边</span>
                              <select
                                value={port.edge}
                                onChange={(event) => moveComponentPortEdge(
                                  selectedElement.id,
                                  port.id,
                                  event.target.value as PortEdge,
                                )}
                              >
                                {Object.entries(portEdgeLabels).map(([edge, label]) => (
                                  <option value={edge} key={edge}>{label}</option>
                                ))}
                              </select>
                            </label>
                            {port.domain === "signal" && (
                              <label className="port-editor-field">
                                <span>协议</span>
                                <input
                                  value={port.protocol ?? ""}
                                  placeholder="CAN / GPIO / UART"
                                  onChange={(event) => updateComponentPort(selectedElement.id, port.id, { protocol: event.target.value })}
                                />
                              </label>
                            )}
                            <label className="port-editor-field">
                              <span>电压</span>
                              <input
                                value={port.voltage ?? ""}
                                placeholder="24V / 3.3V"
                                onChange={(event) => updateComponentPort(selectedElement.id, port.id, { voltage: event.target.value })}
                              />
                            </label>
                            <label className="port-editor-field">
                              <span>电流</span>
                              <input
                                value={port.current ?? ""}
                                placeholder="2A / ≤6A"
                                onChange={(event) => updateComponentPort(selectedElement.id, port.id, { current: event.target.value })}
                              />
                            </label>
                            <label className="port-editor-field full position-field">
                              <span>边缘位置 <em>{Math.round(port.offset * 100)}%</em></span>
                              <input
                                type="range"
                                min="0.08"
                                max="0.92"
                                step="0.01"
                                value={port.offset}
                                onChange={(event) => updateComponentPort(selectedElement.id, port.id, { offset: Number(event.target.value) })}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="inspector-note">点击接口框可编辑信息并直接拖动调整位置；点击接口边缘的圆形触点才会开始连线。拖动时同侧接口会自动避让。</p>
              </div>
            </div>
          )}

          {selectedBranch && (
            <div className="inspector-content">
              <div className="selection-kind"><span style={{ background: selectedBranchColor }} />母线支路</div>
              <div className="field read-only"><span>所属母线</span><strong>{selectedBranch.network.name}</strong></div>
              <div className="field read-only"><span>连接模块</span><strong>{selectedBranch.component.name}</strong></div>
              <div className="field read-only split-field"><span>接口</span><strong>{selectedBranch.port.name}</strong></div>
              <div className="field read-only split-field"><span>电压</span><strong>{selectedBranch.port.voltage ?? "—"}</strong></div>
              <div className="field read-only split-field"><span>电流</span><strong>{selectedBranch.port.current ?? "—"}</strong></div>
              <div className="field read-only split-field"><span>母线支路数</span><strong>{selectedBranch.network.memberIds.length}</strong></div>
              <ColorProperty
                label="支路颜色"
                color={selectedBranchColor ?? selectedBranch.network.color}
                onChange={(color) => updateBranchColor(selectedBranch.network.id, selectedBranch.memberRef, color)}
              />
              {selectedBranch.network.branchColors?.[selectedBranch.memberRef] && (
                <button
                  className="button secondary inherit-color-button"
                  onClick={() => updateBranchColor(selectedBranch.network.id, selectedBranch.memberRef)}
                >
                  恢复跟随母线颜色
                </button>
              )}
              <div className="property-section route-editor-help">
                <div className="property-section-title"><strong>支路走线</strong><span>独立操作</span></div>
                <p>拖动蓝色圆点调整支路；靠近水平或垂直方向会吸附为平行/90°，按住 Alt 可自由拖动。双击线段新增拐点，双击圆点删除拐点。</p>
                <div className="branch-actions">
                  <button
                    className="button secondary routing-reset"
                    onClick={() => resetBranchRouting(selectedBranch.network.id, selectedBranch.memberRef)}
                  >
                    此支路恢复自动走线
                  </button>
                  <button
                    className="button secondary routing-reset"
                    onClick={() => setSelection({ kind: "network", id: selectedBranch.network.id })}
                  >
                    选择整条母线
                  </button>
                  <button className="button branch-disconnect" onClick={removeSelection}>
                    断开此支路
                  </button>
                </div>
              </div>
              <p className="inspector-note">断开此支路只会移除当前接口到汇合点的线，其余支路和母线保持不变。</p>
            </div>
          )}

          {selectedNetwork && (
            <div className="inspector-content">
              <div className="selection-kind"><span style={{ background: selectedNetwork.color }} />共享母线</div>
              <label className="field">
                <span>网络名称</span>
                <input value={selectedNetwork.name} onChange={(event) => updateNetwork(selectedNetwork.id, { name: event.target.value })} />
              </label>
              <ColorProperty
                label="母线颜色"
                color={selectedNetwork.color}
                onChange={(color) => updateNetwork(selectedNetwork.id, { color })}
              />
              <div className="field read-only split-field"><span>类别</span><strong>{selectedNetwork.domain === "power" ? "电源" : "信号"}</strong></div>
              <div className="field read-only split-field"><span>协议</span><strong>{selectedNetwork.protocol ?? "—"}</strong></div>
              <div className="property-section">
                <div className="property-section-title"><strong>已吸附接口</strong><span>{selectedNetwork.memberIds.length}</span></div>
                <div className="network-members">
                  {selectedNetwork.memberIds.map((ref) => {
                    const result = getPort(document, ref);
                    if (!result) return null;
                    return (
                      <div key={ref}>
                        <span className={`property-port-dot ${result.port.domain}`} />
                        <p><strong>{result.component.name}</strong><small>{result.port.name} · {portDetails(result.port)}</small></p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="property-section route-editor-help">
                <div className="property-section-title"><strong>走线编辑</strong><span>可自定义</span></div>
                <p>这里会显示全部支路的拐点。拖动中心方点移动母线汇合位置。</p>
                <button className="button secondary routing-reset" onClick={() => resetNetworkRouting(selectedNetwork.id)}>
                  恢复自动走线
                </button>
              </div>
              <p className="inspector-note warning-note">当前选中的是整条母线。删除会移除全部支路；若只想断开一根线，请直接点击那根线。</p>
            </div>
          )}

          {selectedElement?.kind === "text" && (
            <div className="inspector-content">
              <div className="selection-kind"><span className="text-kind" />文字</div>
              <label className="field">
                <span>内容</span>
                <textarea rows={5} value={selectedElement.text} onChange={(event) => updateElement(selectedElement.id, { text: event.target.value })} />
              </label>
              <label className="field">
                <span>字号</span>
                <input type="number" min="10" max="96" value={selectedElement.fontSize} onChange={(event) => updateElement(selectedElement.id, { fontSize: Number(event.target.value) })} />
              </label>
            </div>
          )}

          {selectedElement?.kind === "image" && (
            <div className="inspector-content">
              <div className="selection-kind"><span className="image-kind" />图片</div>
              <div className="field read-only"><span>文件</span><strong>{document.assets[selectedElement.assetId]?.name ?? selectedElement.alt}</strong></div>
              <div className="field read-only split-field"><span>尺寸</span><strong>{Math.round(selectedElement.width)} × {Math.round(selectedElement.height)}</strong></div>
            </div>
          )}
        </aside>
      </div>

      <input
        ref={projectInputRef}
        hidden
        type="file"
        accept=".sanwdraw,application/x-sanwdraw"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          if (file) void openProject(file);
          event.target.value = "";
        }}
      />
      <input
        ref={imageInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          if (file) void addImageFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export default App;
