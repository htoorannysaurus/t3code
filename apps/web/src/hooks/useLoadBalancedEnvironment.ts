import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { chooseLoadBalancedEnvironment } from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext } from "react";

import { serverEnvironment } from "../state/server";

// Keyed by content: callers derive the list every render.
const hostResourcesAtom = Atom.family((environmentIdsKey: string) =>
  Atom.make((get) => ({
    // Staleness is judged when a snapshot is read, which keeps render pure.
    evaluatedAt: Date.now(),
    resources: (environmentIdsKey === ""
      ? []
      : (environmentIdsKey.split("\n") as EnvironmentId[])
    ).map((environmentId) => {
      const result = get(serverEnvironment.hostResources({ environmentId, input: {} }));
      return {
        environmentId,
        resources: result._tag === "Success" ? result.value : null,
        receivedAt: result._tag === "Success" ? result.timestamp : 0,
        pending: result._tag === "Initial" || result.waiting,
        failed: result._tag === "Failure",
      };
    }),
  })),
);

/** Only mounted for unresolved automatic drafts, so idle clients do not poll hosts. */
export function useLoadBalancedEnvironment(
  environmentIds: readonly EnvironmentId[],
  weights: Readonly<Record<string, number>>,
) {
  const registry = useContext(RegistryContext);
  const refresh = (ids: readonly EnvironmentId[]) => {
    for (const environmentId of ids) {
      registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
    }
  };
  const { evaluatedAt, resources } = useAtomValue(hostResourcesAtom(environmentIds.join("\n")));
  const pending = resources.some((resource) => resource.pending);
  const environmentId = chooseLoadBalancedEnvironment(
    resources.map((resource) => ({
      ...resource,
      weight: weights[resource.environmentId] ?? 50,
    })),
    evaluatedAt,
  ) as EnvironmentId | null;
  return {
    refresh,
    pending,
    environmentId,
    failed: !pending && environmentId === null && resources.some((resource) => resource.failed),
  };
}
