import type { Network } from "./types";

/**
 * Disconnect one port branch from a shared network.
 * A network with fewer than two endpoints no longer represents a connection.
 */
export const disconnectNetworkBranch = (
  network: Network,
  memberRef: string,
): Network | undefined => {
  if (!network.memberIds.includes(memberRef)) return network;
  const memberIds = network.memberIds.filter((ref) => ref !== memberRef);
  if (memberIds.length < 2) return undefined;

  const routes = { ...network.routes };
  delete routes[memberRef];
  const branchColors = { ...network.branchColors };
  delete branchColors[memberRef];
  return {
    ...network,
    memberIds,
    routes: Object.keys(routes).length ? routes : undefined,
    branchColors: Object.keys(branchColors).length ? branchColors : undefined,
  };
};
