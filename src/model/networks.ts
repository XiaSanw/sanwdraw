import type { Network } from "./types";

/**
 * Drop only the saved bend points for branches whose endpoints moved.
 * The network junction and every unaffected branch keep their manual layout.
 */
export const resetNetworkRoutesForMembers = (
  networks: Network[],
  memberRefs: Iterable<string>,
) => {
  const refs = new Set(memberRefs);
  if (!refs.size) return networks;

  let networksChanged = false;
  const nextNetworks = networks.map((network) => {
    if (!network.routes) return network;
    const routes = { ...network.routes };
    let routesChanged = false;
    refs.forEach((ref) => {
      if (routes[ref] === undefined) return;
      delete routes[ref];
      routesChanged = true;
    });
    if (!routesChanged) return network;
    networksChanged = true;
    return {
      ...network,
      routes: Object.keys(routes).length ? routes : undefined,
    };
  });

  return networksChanged ? nextNetworks : networks;
};

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
