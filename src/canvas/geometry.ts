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

export const networkHub = (document: SanwDocument, network: Network): Point => {
  if (network.junction) return network.junction;
  const points = getNetworkPoints(document, network);
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, item) => sum + item.point.x, 0) / points.length,
    y: points.reduce((sum, item) => sum + item.point.y, 0) / points.length,
  };
};

export const defaultRoutePointsToHub = (
  point: Point,
  edge: InterfacePort["edge"],
  hub: Point,
): Point[] => {
  // Give every port a visible outward lead before the first 90° turn so the
  // route does not run along the edge of the port box.
  const stub = 28;
  if (edge === "left" || edge === "right") {
    const stubX = point.x + (edge === "left" ? -stub : stub);
    return [
      { x: stubX, y: point.y },
      { x: stubX, y: hub.y },
    ];
  }
  const stubY = point.y + (edge === "top" ? -stub : stub);
  return [
    { x: point.x, y: stubY },
    { x: hub.x, y: stubY },
  ];
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
