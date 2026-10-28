import { ACTION_NAME_RULE, isValidActionName } from "./agent";
import { withPrefix } from "./errors";

/**
 * Throws a prefixed error unless `name` is a valid action name. Kept apart from the runtime registry
 * so helpers that register nothing (agentLinkProps) do not pull it in.
 */
export function assertValidActionName(name: string): void {
  if (!isValidActionName(name)) throw new Error(withPrefix(`invalid action name "${name}": ${ACTION_NAME_RULE}`));
}
