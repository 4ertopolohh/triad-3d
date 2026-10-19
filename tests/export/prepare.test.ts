import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { generateSpikeTsx } from "../../src/spikes/export/generate-tsx";
import { createMaterialAnimationProject } from "../fixtures/projects";

test("write generated component for isolated harness", async () => {
  const output = process.env.TRIAD_HARNESS_OUTPUT;
  const result = generateSpikeTsx(createMaterialAnimationProject());
  if (!output) {
    if (!result.source.includes("function TriadModel")) throw new Error("TSX was not generated");
    return;
  }
  const sourceDirectory = join(output, "src");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, result.filename), result.source, "utf8");
});
