import type { InterfacePort, PortEdge } from "./types";
import { portRef } from "./types";

const DISTRIBUTION_MIN = 0.08;
const DISTRIBUTION_MAX = 0.92;

/** Keep ports on the requested edges ordered and evenly spaced. */
export const distributePortsOnEdges = (
  ports: InterfacePort[],
  edges: Iterable<PortEdge>,
) => {
  const offsets = new Map<string, number>();
  const edgeSet = new Set(edges);

  edgeSet.forEach((edge) => {
    const edgePorts = ports
      .filter((port) => port.edge === edge)
      .sort((a, b) => a.offset - b.offset);
    edgePorts.forEach((port, index) => {
      const offset = edgePorts.length === 1
        ? 0.5
        : DISTRIBUTION_MIN
          + (DISTRIBUTION_MAX - DISTRIBUTION_MIN) * (index / (edgePorts.length - 1));
      offsets.set(port.id, offset);
    });
  });

  return ports.map((port) => {
    const offset = offsets.get(port.id);
    return offset === undefined ? port : { ...port, offset };
  });
};

export const movePortToEdge = (
  ports: InterfacePort[],
  portId: string,
  edge: PortEdge,
) => {
  const movingPort = ports.find((port) => port.id === portId);
  if (!movingPort || movingPort.edge === edge) return ports;
  const moved = ports.map((port) =>
    port.id === portId ? { ...port, edge } : port,
  );
  return distributePortsOnEdges(moved, [movingPort.edge, edge]);
};

/** Return the member references whose rendered endpoint actually moved. */
export const changedPortRefs = (
  componentId: string,
  previousPorts: InterfacePort[],
  nextPorts: InterfacePort[],
) => {
  const previousById = new Map(previousPorts.map((port) => [port.id, port]));
  return nextPorts.flatMap((port) => {
    const previous = previousById.get(port.id);
    if (
      !previous ||
      previous.edge !== port.edge ||
      Math.abs(previous.offset - port.offset) > 0.0001
    ) {
      return [portRef(componentId, port.id)];
    }
    return [];
  });
};
