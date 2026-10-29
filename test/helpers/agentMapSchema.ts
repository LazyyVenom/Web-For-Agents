import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { AGENT_MAP_VERSION } from "../../src/shared/agent";

const file = path.resolve(__dirname, `../../schemas/agents.v${AGENT_MAP_VERSION}.schema.json`);
const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(file, "utf8")));

/** The errors of `map` against the agents.json JSON Schema of the current version, as "path message"; [] when valid. */
export function validateAgentMap(map: unknown): string[] {
  return validate(map) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}
