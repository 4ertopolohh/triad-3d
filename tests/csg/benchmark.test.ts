import { it } from "vitest";
import { compute, makeInputs, manifoldModule } from "../../src/spikes/csg/core";

it("records repeatable CSG measurements", async () => {
  const initStart = performance.now();
  await manifoldModule();
  console.log(`WASM init: ${(performance.now() - initStart).toFixed(1)} ms`);
  for (const detail of ["low", "medium", "high"] as const) {
    const [a, b] = makeInputs("subtract", detail);
    const result = await compute("subtract", a, b);
    console.log(`${detail}: in=${result.inputTriangles} out=${result.outputTriangles} csg=${result.computeMs.toFixed(1)}ms status=${result.status}`);
  }
});
