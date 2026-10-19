import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const isolated = await mkdtemp(join(tmpdir(), "triad-tsx-harness-"));
await cp(join(root, "harness", "tsx-export"), isolated, { recursive: true });

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

run("npm", ["exec", "vitest", "run", "tests/export/prepare.test.ts"], root, {
  ...process.env, TRIAD_HARNESS_OUTPUT: isolated,
});
const generated = await readFile(join(isolated, "src", "TriadModel.tsx"), "utf8");
if (/from\s+["'][^"']*(?:src\/domain|src\/ui|triad-3d)/.test(generated)) throw new Error("Generated component imports editor internals");
run("npm", ["ci", "--no-audit", "--no-fund"], isolated);
run("npm", ["run", "typecheck"], isolated);
run("npm", ["run", "build"], isolated);
await stat(join(isolated, "dist", "index.html"));
console.log(`Independent harness PASS: ${isolated}`);
