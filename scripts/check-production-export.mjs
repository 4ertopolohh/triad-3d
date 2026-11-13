import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const isolated = await mkdtemp(join(tmpdir(), "triad-production-export-"));
const optimized = await mkdtemp(join(tmpdir(), "triad-optimized-export-"));
function run(args, cwd, env = process.env) {
  const result = spawnSync("npm", args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`Export harness failed: npm ${args.join(" ")} (${result.status})`);
}
run(["exec", "--", "vitest", "run", "tests/export/package.test.ts"], root, {
  ...process.env, TRIAD_PRODUCTION_EXPORT: isolated, TRIAD_OPTIMIZED_EXPORT: optimized,
});
await stat(join(isolated, "src", "StandaloneModel.tsx"));
run(["install", "--no-audit", "--no-fund"], isolated);
run(["run", "build"], isolated);
await stat(join(isolated, "dist", "index.html"));
console.log(`Production export and standalone component PASS: ${isolated}`);
await stat(join(optimized, "src", "geometry.json"));
run(["install", "--no-audit", "--no-fund"], optimized);
run(["run", "build"], optimized);
await stat(join(optimized, "dist", "index.html"));
console.log(`Compressed geometry export PASS: ${optimized}`);
