#!/usr/bin/env node
// Swaps the repo's Vite for another major (without touching package.json or the lockfile), for
// testing the plugin against every Vite version the peer range claims. Run after `npm ci`:
//
//   node scripts/install-vite.mjs 5
//
// Installs vite@<major> and the @vitejs/plugin-react major that supports it. Vitest 5 itself
// needs Vite >=6.4, so for Vite 5 a Vite 8 copy is installed under another name and linked into
// vitest's own node_modules: Vitest runs on Vite 8, while the tests and the plugin import Vite 5.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

const PLUGIN_REACT = { 5: "4", 6: "4", 7: "5", 8: "6" };
const major = process.argv[2];
if (!(major in PLUGIN_REACT)) {
  console.error(`usage: node scripts/install-vite.mjs <${Object.keys(PLUGIN_REACT).join("|")}>`);
  process.exit(2);
}

const npm = (args) => execFileSync("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
const pkgs = [`vite@${major}`, `@vitejs/plugin-react@${PLUGIN_REACT[major]}`];

if (major === "5") {
  npm(["install", "--no-save", "--no-audit", "--no-fund", "--legacy-peer-deps", ...pkgs, "vite-for-vitest@npm:vite@8"]);
  for (const dir of ["node_modules/vitest", "node_modules/@vitest/mocker"]) {
    const link = path.join(dir, "node_modules/vite");
    mkdirSync(path.dirname(link), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(path.relative(path.dirname(link), "node_modules/vite-for-vitest"), link, "junction");
  }
} else {
  npm(["install", "--no-save", "--no-audit", "--no-fund", ...pkgs]);
}

const version = (p) => JSON.parse(readFileSync(path.join("node_modules", p, "package.json"), "utf8")).version;
const got = version("vite");
if (got.split(".")[0] !== major) {
  console.error(`expected vite ${major}.x, found ${got}`);
  process.exit(1);
}
console.log(`vite ${got}, @vitejs/plugin-react ${version("@vitejs/plugin-react")}`);
