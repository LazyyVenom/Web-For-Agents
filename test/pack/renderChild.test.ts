import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canObserveModuleLoads, wrappersInstalledBeforeHappyDom } from "../helpers/childOrder";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

describe.skipIf(!canObserveModuleLoads)("built render process chunk", () => {
  it("installs the network wrappers before happy-dom is evaluated", async () => {
    const chunk = readdirSync(dist).find((f) => /^renderChild-.*\.js$/.test(f));
    expect(chunk, "dist/renderChild-*.js").toBeDefined();
    expect(await wrappersInstalledBeforeHappyDom(path.join(dist, chunk!))).toBe(true);
  });
});
