import type {
  CanvasElement,
  ComponentElement,
  InterfacePort,
  Network,
  Point,
  PortEdge,
  SanwDocument,
} from "../model/types";
import { parsePortRef } from "../model/types";
import {
  DEFAULT_PORT_GAP,
  getDocumentPortGap,
  PORT_BOX_HEIGHT,
  PORT_BOX_WIDTH,
} from "../model/settings";

const ROUTING_COMPONENT_CLEARANCE = 14;
const ROUTING_PORT_CLEARANCE = 8;
const ROUTING_STUB_LENGTH = 28;
const ROUTING_SEARCH_MARGIN = 180;
const ROUTING_BEND_COST = 24;
const GEOMETRY_EPSILON = 0.001;

export type RoutingObstacle = {
  id: string;
  kind: "component" | "port";
  x: number;
  y: number;
  width: number;
  height: number;
};

const inflateRect = (
  rect: Omit<RoutingObstacle, "id" | "kind">,
  amount: number,
) => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

const pointInsideObstacle = (point: Point, obstacle: RoutingObstacle) =>
  point.x > obstacle.x + GEOMETRY_EPSILON
  && point.x < obstacle.x + obstacle.width - GEOMETRY_EPSILON
  && point.y > obstacle.y + GEOMETRY_EPSILON
  && point.y < obstacle.y + obstacle.height - GEOMETRY_EPSILON;

const segmentCrossesObstacle = (
  start: Point,
  end: Point,
  obstacle: RoutingObstacle,
) => {
  if (Math.abs(start.y - end.y) < GEOMETRY_EPSILON) {
    const y = start.y;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return y > obstacle.y + GEOMETRY_EPSILON
      && y < obstacle.y + obstacle.height - GEOMETRY_EPSILON
      && maxX > obstacle.x + GEOMETRY_EPSILON
      && minX < obstacle.x + obstacle.width - GEOMETRY_EPSILON;
  }
  if (Math.abs(start.x - end.x) < GEOMETRY_EPSILON) {
    const x = start.x;
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return x > obstacle.x + GEOMETRY_EPSILON
      && x < obstacle.x + obstacle.width - GEOMETRY_EPSILON
      && maxY > obstacle.y + GEOMETRY_EPSILON
      && minY < obstacle.y + obstacle.height - GEOMETRY_EPSILON;
  }
  return true;
};

const portBoxRect = (
  component: ComponentElement,
  port: InterfacePort,
  portGap: number,
) => {
  if (port.edge === "left") {
    return {
      x: component.x - portGap - PORT_BOX_WIDTH,
      y: component.y + component.height * port.offset - PORT_BOX_HEIGHT / 2,
      width: PORT_BOX_WIDTH,
      height: PORT_BOX_HEIGHT,
    };
  }
  if (port.edge === "right") {
    return {
      x: component.x + component.width + portGap,
      y: component.y + component.height * port.offset - PORT_BOX_HEIGHT / 2,
      width: PORT_BOX_WIDTH,
      height: PORT_BOX_HEIGHT,
    };
  }
  if (port.edge === "top") {
    return {
      x: component.x + component.width * port.offset - PORT_BOX_WIDTH / 2,
      y: component.y - portGap - PORT_BOX_HEIGHT,
      width: PORT_BOX_WIDTH,
      height: PORT_BOX_HEIGHT,
    };
  }
  return {
    x: component.x + component.width * port.offset - PORT_BOX_WIDTH / 2,
    y: component.y + component.height + portGap,
    width: PORT_BOX_WIDTH,
    height: PORT_BOX_HEIGHT,
  };
};

export const getRoutingObstacles = (document: SanwDocument): RoutingObstacle[] => {
  const portGap = getDocumentPortGap(document);
  return document.elements.flatMap((element) => {
    if (element.kind !== "component") return [];
    const componentBounds = inflateRect({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    }, ROUTING_COMPONENT_CLEARANCE);
    const componentObstacle: RoutingObstacle = {
      id: `component:${element.id}`,
      kind: "component",
      ...componentBounds,
    };
    const portObstacles = element.ports
      .filter((port) => port.enabled !== false)
      .map((port): RoutingObstacle => ({
        id: `port:${element.id}:${port.id}`,
        kind: "port",
        ...inflateRect(portBoxRect(element, port, portGap), ROUTING_PORT_CLEARANCE),
      }));
    return [componentObstacle, ...portObstacles];
  });
};

export const getComponent = (document: SanwDocument, componentId: string) =>
  document.elements.find(
    (element): element is ComponentElement =>
      element.kind === "component" && element.id === componentId,
  );

export const getPort = (document: SanwDocument, ref: string) => {
  const { componentId, portId } = parsePortRef(ref);
  const component = getComponent(document, componentId);
  const port = component?.ports.find((item) => item.id === portId);
  return component && port ? { component, port } : undefined;
};

export const getPortPoint = (
  component: ComponentElement,
  port: InterfacePort,
  portGap = DEFAULT_PORT_GAP,
): Point => {
  if (port.edge === "left") {
    return {
      x: component.x - portGap - PORT_BOX_WIDTH,
      y: component.y + component.height * port.offset,
    };
  }
  if (port.edge === "right") {
    return {
      x: component.x + component.width + portGap + PORT_BOX_WIDTH,
      y: component.y + component.height * port.offset,
    };
  }
  if (port.edge === "top") {
    return {
      x: component.x + component.width * port.offset,
      y: component.y - portGap - PORT_BOX_HEIGHT,
    };
  }
  return {
    x: component.x + component.width * port.offset,
    y: component.y + component.height + portGap + PORT_BOX_HEIGHT,
  };
};

export const getRefPoint = (document: SanwDocument, ref: string) => {
  const result = getPort(document, ref);
  return result
    ? getPortPoint(result.component, result.port, getDocumentPortGap(document))
    : undefined;
};

export const nearestComponentEdgePlacement = (
  component: ComponentElement,
  point: Point,
): { edge: PortEdge; offset: number } => {
  const clampOffset = (value: number) => Math.max(0.08, Math.min(0.92, value));
  const horizontalOffset = clampOffset((point.x - component.x) / component.width);
  const verticalOffset = clampOffset((point.y - component.y) / component.height);
  const projectedX = component.x + component.width * horizontalOffset;
  const projectedY = component.y + component.height * verticalOffset;
  const candidates: Array<{ edge: PortEdge; offset: number; distance: number }> = [
    {
      edge: "left",
      offset: verticalOffset,
      distance: (point.x - component.x) ** 2 + (point.y - projectedY) ** 2,
    },
    {
      edge: "right",
      offset: verticalOffset,
      distance: (point.x - component.x - component.width) ** 2 + (point.y - projectedY) ** 2,
    },
    {
      edge: "top",
      offset: horizontalOffset,
      distance: (point.x - projectedX) ** 2 + (point.y - component.y) ** 2,
    },
    {
      edge: "bottom",
      offset: horizontalOffset,
      distance: (point.x - projectedX) ** 2 + (point.y - component.y - component.height) ** 2,
    },
  ];

  return candidates.reduce((closest, candidate) =>
    candidate.distance < closest.distance ? candidate : closest,
  );
};

export const getNetworkPoints = (document: SanwDocument, network: Network) => {
  const portGap = getDocumentPortGap(document);
  return network.memberIds
    .map((ref) => {
      const result = getPort(document, ref);
      if (!result) return undefined;
      return {
        ref,
        point: getPortPoint(result.component, result.port, portGap),
        edge: result.port.edge,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
};

const nearestFreeRoutingPoint = (point: Point, obstacles: RoutingObstacle[]): Point => {
  if (!obstacles.some((obstacle) => pointInsideObstacle(point, obstacle))) return point;
  const xValues = [point.x, ...obstacles.flatMap((obstacle) => [
    obstacle.x,
    obstacle.x + obstacle.width,
  ])];
  const yValues = [point.y, ...obstacles.flatMap((obstacle) => [
    obstacle.y,
    obstacle.y + obstacle.height,
  ])];
  let best: Point | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  xValues.forEach((x) => {
    yValues.forEach((y) => {
      const candidate = { x, y };
      if (obstacles.some((obstacle) => pointInsideObstacle(candidate, obstacle))) return;
      const distance = Math.abs(x - point.x) + Math.abs(y - point.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
  });
  return best ?? point;
};

export const networkHub = (
  document: SanwDocument,
  network: Network,
  routingObstacles = getRoutingObstacles(document),
): Point => {
  if (network.junction) return network.junction;
  const points = getNetworkPoints(document, network);
  if (!points.length) return { x: 0, y: 0 };
  return nearestFreeRoutingPoint({
    x: points.reduce((sum, item) => sum + item.point.x, 0) / points.length,
    y: points.reduce((sum, item) => sum + item.point.y, 0) / points.length,
  }, routingObstacles);
};

export const defaultRoutePointsToHub = (
  point: Point,
  edge: InterfacePort["edge"],
  hub: Point,
): Point[] => {
  // Give every port a visible outward lead before the first 90° turn so the
  // route does not run along the edge of the port box.
  if (edge === "left" || edge === "right") {
    const stubX = point.x + (edge === "left" ? -ROUTING_STUB_LENGTH : ROUTING_STUB_LENGTH);
    return [
      { x: stubX, y: point.y },
      { x: stubX, y: hub.y },
    ];
  }
  const stubY = point.y + (edge === "top" ? -ROUTING_STUB_LENGTH : ROUTING_STUB_LENGTH);
  return [
    { x: point.x, y: stubY },
    { x: hub.x, y: stubY },
  ];
};

const routingCoordinate = (value: number) => Math.round(value * 1000) / 1000;

const uniqueCoordinates = (values: number[]) => [...new Set(
  values.map(routingCoordinate),
)].sort((a, b) => a - b);

const simplifyOrthogonalPath = (points: Point[]) => {
  const deduplicated = points.filter((point, index) =>
    index === 0
    || Math.abs(point.x - points[index - 1].x) > GEOMETRY_EPSILON
    || Math.abs(point.y - points[index - 1].y) > GEOMETRY_EPSILON,
  );
  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    const sameX = Math.abs(previous.x - point.x) < GEOMETRY_EPSILON
      && Math.abs(point.x - next.x) < GEOMETRY_EPSILON
      && (point.y - previous.y) * (next.y - point.y) >= 0;
    const sameY = Math.abs(previous.y - point.y) < GEOMETRY_EPSILON
      && Math.abs(point.y - next.y) < GEOMETRY_EPSILON
      && (point.x - previous.x) * (next.x - point.x) >= 0;
    return !sameX && !sameY;
  });
};

type RoutingEdge = { to: number; length: number; direction: 1 | 2 };
type HeapEntry = { state: number; cost: number };

const pushHeap = (heap: HeapEntry[], entry: HeapEntry) => {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].cost <= entry.cost) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = entry;
};

const popHeap = (heap: HeapEntry[]) => {
  if (!heap.length) return undefined;
  const first = heap[0];
  const tail = heap.pop();
  if (!heap.length || !tail) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    const child = right < heap.length && heap[right].cost < heap[left].cost ? right : left;
    if (heap[child].cost >= tail.cost) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = tail;
  return first;
};

/**
 * Find a short orthogonal route from a port to a network hub while treating
 * component bodies and visible interface boxes as inflated no-go regions.
 */
export const autoRoutePointsToHub = (
  point: Point,
  edge: InterfacePort["edge"],
  hub: Point,
  routingObstacles: RoutingObstacle[],
): Point[] => {
  const fallback = defaultRoutePointsToHub(point, edge, hub);
  const stub = fallback[0];
  const minX = Math.min(stub.x, hub.x) - ROUTING_SEARCH_MARGIN;
  const maxX = Math.max(stub.x, hub.x) + ROUTING_SEARCH_MARGIN;
  const minY = Math.min(stub.y, hub.y) - ROUTING_SEARCH_MARGIN;
  const maxY = Math.max(stub.y, hub.y) + ROUTING_SEARCH_MARGIN;
  const obstacles = routingObstacles.filter((obstacle) =>
    obstacle.x < maxX
    && obstacle.x + obstacle.width > minX
    && obstacle.y < maxY
    && obstacle.y + obstacle.height > minY,
  );

  const segmentIsClear = (start: Point, end: Point) =>
    !obstacles.some((obstacle) => segmentCrossesObstacle(start, end, obstacle));

  if (
    (Math.abs(stub.x - hub.x) < GEOMETRY_EPSILON
      || Math.abs(stub.y - hub.y) < GEOMETRY_EPSILON)
    && segmentIsClear(stub, hub)
  ) {
    return simplifyOrthogonalPath([point, stub, hub]).slice(1, -1);
  }

  const xValues = uniqueCoordinates([
    stub.x,
    hub.x,
    ...obstacles.flatMap((obstacle) => [obstacle.x, obstacle.x + obstacle.width]),
  ]);
  const yValues = uniqueCoordinates([
    stub.y,
    hub.y,
    ...obstacles.flatMap((obstacle) => [obstacle.y, obstacle.y + obstacle.height]),
  ]);
  const nodes: Point[] = [];
  const nodeByCoordinate = new Map<string, number>();
  const coordinateKey = (xIndex: number, yIndex: number) => `${xIndex}:${yIndex}`;

  yValues.forEach((y, yIndex) => {
    xValues.forEach((x, xIndex) => {
      const candidate = { x, y };
      if (obstacles.some((obstacle) => pointInsideObstacle(candidate, obstacle))) return;
      nodeByCoordinate.set(coordinateKey(xIndex, yIndex), nodes.length);
      nodes.push(candidate);
    });
  });

  const xIndexByValue = new Map(xValues.map((value, index) => [value, index]));
  const yIndexByValue = new Map(yValues.map((value, index) => [value, index]));
  const startNode = nodeByCoordinate.get(coordinateKey(
    xIndexByValue.get(routingCoordinate(stub.x)) ?? -1,
    yIndexByValue.get(routingCoordinate(stub.y)) ?? -1,
  ));
  const targetNode = nodeByCoordinate.get(coordinateKey(
    xIndexByValue.get(routingCoordinate(hub.x)) ?? -1,
    yIndexByValue.get(routingCoordinate(hub.y)) ?? -1,
  ));
  if (startNode === undefined || targetNode === undefined) return fallback;

  const adjacency: RoutingEdge[][] = Array.from({ length: nodes.length }, () => []);
  const connect = (from: number, to: number, direction: 1 | 2) => {
    if (!segmentIsClear(nodes[from], nodes[to])) return;
    const length = Math.abs(nodes[from].x - nodes[to].x) + Math.abs(nodes[from].y - nodes[to].y);
    adjacency[from].push({ to, length, direction });
    adjacency[to].push({ to: from, length, direction });
  };

  yValues.forEach((_, yIndex) => {
    let previous: number | undefined;
    xValues.forEach((__, xIndex) => {
      const node = nodeByCoordinate.get(coordinateKey(xIndex, yIndex));
      if (node === undefined) return;
      if (previous !== undefined) connect(previous, node, 1);
      previous = node;
    });
  });
  xValues.forEach((_, xIndex) => {
    let previous: number | undefined;
    yValues.forEach((__, yIndex) => {
      const node = nodeByCoordinate.get(coordinateKey(xIndex, yIndex));
      if (node === undefined) return;
      if (previous !== undefined) connect(previous, node, 2);
      previous = node;
    });
  });

  const stateCount = nodes.length * 3;
  const distances = new Float64Array(stateCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const previousStates = new Int32Array(stateCount);
  previousStates.fill(-1);
  const startState = startNode * 3;
  distances[startState] = 0;
  const heap: HeapEntry[] = [];
  pushHeap(heap, { state: startState, cost: 0 });
  let targetState = -1;

  while (heap.length) {
    const current = popHeap(heap);
    if (!current || current.cost !== distances[current.state]) continue;
    const node = Math.floor(current.state / 3);
    const previousDirection = current.state % 3;
    if (node === targetNode) {
      targetState = current.state;
      break;
    }
    adjacency[node].forEach((candidate) => {
      const bendCost = previousDirection !== 0 && previousDirection !== candidate.direction
        ? ROUTING_BEND_COST
        : 0;
      const nextState = candidate.to * 3 + candidate.direction;
      const nextCost = current.cost + candidate.length + bendCost;
      if (nextCost >= distances[nextState]) return;
      distances[nextState] = nextCost;
      previousStates[nextState] = current.state;
      pushHeap(heap, { state: nextState, cost: nextCost });
    });
  }

  if (targetState < 0) return fallback;
  const reversed: Point[] = [];
  let cursor = targetState;
  while (cursor >= 0) {
    reversed.push(nodes[Math.floor(cursor / 3)]);
    cursor = previousStates[cursor];
  }
  const route = simplifyOrthogonalPath([point, ...reversed.reverse()]);
  return route.slice(1, -1);
};

export const routeToHub = (
  point: Point,
  edge: InterfacePort["edge"],
  hub: Point,
  routePoints?: Point[],
) => {
  const bends = routePoints ?? defaultRoutePointsToHub(point, edge, hub);
  const points = [point, ...bends, hub];
  return points
    .map((item, index) => `${index === 0 ? "M" : "L"} ${item.x} ${item.y}`)
    .join(" ");
};

export type OrthogonalSnapResult = {
  point: Point;
  snappedX?: number;
  snappedY?: number;
};

/**
 * Snap a moving point onto the horizontal or vertical axes of nearby anchors.
 * This keeps adjacent harness segments parallel or at 90° while still allowing
 * free-form routing whenever the pointer is outside the snap distance.
 */
export const snapPointToOrthogonalAnchors = (
  point: Point,
  anchors: Point[],
  threshold: number,
): OrthogonalSnapResult => {
  let snappedX: number | undefined;
  let snappedY: number | undefined;
  let closestX = Math.max(0, threshold);
  let closestY = Math.max(0, threshold);

  anchors.forEach((anchor) => {
    const distanceX = Math.abs(point.x - anchor.x);
    const distanceY = Math.abs(point.y - anchor.y);
    if (distanceX <= closestX) {
      closestX = distanceX;
      snappedX = anchor.x;
    }
    if (distanceY <= closestY) {
      closestY = distanceY;
      snappedY = anchor.y;
    }
  });

  return {
    point: {
      x: snappedX ?? point.x,
      y: snappedY ?? point.y,
    },
    snappedX,
    snappedY,
  };
};

export const nearestPointOnPath = (points: Point[], target: Point) => {
  let closestIndex = 0;
  let closestPoint = target;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared));
    const projected = { x: start.x + dx * projection, y: start.y + dy * projection };
    const distance = (target.x - projected.x) ** 2 + (target.y - projected.y) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
      closestPoint = projected;
    }
  }

  return { segmentIndex: closestIndex, point: closestPoint };
};

export const documentBounds = (elements: CanvasElement[], expansion = 0) => {
  if (!elements.length) return { x: 0, y: 0, width: 1000, height: 700 };
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));
  return {
    x: minX - expansion,
    y: minY - expansion,
    width: maxX - minX + expansion * 2,
    height: maxY - minY + expansion * 2,
  };
};
