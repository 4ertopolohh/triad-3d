import { describe, expect, it } from "vitest";
import { BoxGeometry, TetrahedronGeometry, TorusGeometry } from "three";
import { fromThree } from "../../src/geometry/csg";
import { manifoldModule } from "../../src/geometry/csg/core";
import { evaluateBevel, parseBevelParameters } from "../../src/geometry/modifiers/bevel";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { validateProject } from "../../src/domain/validate-project";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import type { Modifier } from "../../src/domain/types";

function cube() { const geometry = new BoxGeometry(2, 2, 2); try { return fromThree(geometry); } finally { geometry.dispose(); } }
function tetrahedron() { const geometry = new TetrahedronGeometry(1); try { return fromThree(geometry); } finally { geometry.dispose(); } }
function volume(mesh: ReturnType<typeof cube>) {
  let sum = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3;
    sum += mesh.positions[a]! * (mesh.positions[b + 1]! * mesh.positions[c + 2]! - mesh.positions[b + 2]! * mesh.positions[c + 1]!)
      + mesh.positions[a + 1]! * (mesh.positions[b + 2]! * mesh.positions[c]! - mesh.positions[b]! * mesh.positions[c + 2]!)
      + mesh.positions[a + 2]! * (mesh.positions[b]! * mesh.positions[c + 1]! - mesh.positions[b + 1]! * mesh.positions[c]!);
  }
  return sum / 6;
}

describe("Bevel geometry", () => {
  it("cuts cube edges into a deterministic closed solid without changing input", async () => {
    const input = cube(), original = input.positions.slice(), indices = input.indices.slice();
    const first = await evaluateBevel(input, { width: 0.2 });
    const second = await evaluateBevel(input, { width: 0.2 });
    expect(first.indices.length).toBeGreaterThan(input.indices.length);
    expect(volume(first)).toBeGreaterThan(0);
    expect(volume(first)).toBeLessThan(volume(input));
    expect([...first.positions]).toEqual([...second.positions]);
    expect([...first.indices]).toEqual([...second.indices]);
    expect([...input.positions]).toEqual([...original]);
    expect([...input.indices]).toEqual([...indices]);
    expect([...first.positions].some(v => Math.abs(Math.abs(v) - 0.8) < 1e-5)).toBe(true);
    const uncut = await evaluateBevel(input, { width: 0.2, angleDegrees: 180 });
    expect([...uncut.positions]).toEqual([...input.positions]);
  });
  it("supports another convex body and a zero-width identity", async () => {
    const input = tetrahedron();
    const identity = await evaluateBevel(input, { width: 0 });
    expect([...identity.positions]).toEqual([...input.positions]);
    expect(identity.positions).not.toBe(input.positions);
    const beveled = await evaluateBevel(input, { width: 0.08, angleDegrees: 20 });
    expect(beveled.indices.length).toBeGreaterThan(input.indices.length);
  });
  it("rejects bad parameters, open meshes and excessive width", async () => {
    for (const value of [{}, { width: -1 }, { width: "1" }, { width: Infinity }, { width: 1, segments: 2 }, { width: 1, angleDegrees: 181 }])
      expect(() => parseBevelParameters(value)).toThrow();
    expect(parseBevelParameters({ width: 0 })).toEqual({ width: 0 });
    const input = cube();
    await expect(evaluateBevel(input, { width: 1.1 })).rejects.toMatchObject({ code: "BEVEL_WIDTH_TOO_LARGE" });
    const open = { positions: input.positions.slice(), indices: input.indices.slice(0, -3) };
    await expect(evaluateBevel(open, { width: 0.2 })).rejects.toMatchObject({ code: "GEOMETRY_NON_MANIFOLD" });
    const torus = new TorusGeometry(1, 0.3, 8, 12);
    try { await expect(evaluateBevel(fromThree(torus), { width: 0.1 })).rejects.toMatchObject({ code: "GEOMETRY_NON_MANIFOLD" }); }
    finally { torus.dispose(); }
    const cancelled = new AbortController(); cancelled.abort();
    await expect(evaluateBevel(input, { width: 0.2 }, cancelled.signal)).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    await manifoldModule();
    const duringCuts = new AbortController();
    setTimeout(() => duringCuts.abort(), 0);
    await expect(evaluateBevel(input, { width: 0.2 }, duringCuts.signal)).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    const tooComplex = { positions: input.positions.slice(), indices: Uint32Array.from({ length: 4098 * 3 }, (_, i) => input.indices[i % input.indices.length]!) };
    await expect(evaluateBevel(tooComplex, { width: 0.2 })).rejects.toMatchObject({ code: "RESOURCE_TOO_LARGE" });
    expect(input.positions[0]).toBe(1);
  });
  it("uses stack order, disabled state, cache, fallback and domain validation", async () => {
    const project = createProject(() => `id-${Math.random()}`), root = project.nodes[0]!;
    const node = createPrimitiveNode("cube", root.id, "cube");
    root.children.push(node.id); project.nodes.push(node);
    const bevel: Modifier = { id: "bevel", nodeId: node.id, kind: "bevel", order: 0, enabled: true, version: 0, parameters: { width: 0.2 } };
    const array: Modifier = { id: "array", nodeId: node.id, kind: "array", order: 1, enabled: true, version: 0, parameters: { mode: "linear", count: 2, axis: "x", step: 3, offset: [0, 0, 0] } };
    node.modifierIds.push(bevel.id, array.id); project.modifiers.push(bevel, array);
    expect(validateProject(project)).toEqual([]);
    bevel.parameters.angleDegrees = 45;
    const serialized = serializeProjectDocument(project);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) {
      const restored = deserializeProjectDocument(serialized.value);
      expect(restored.ok && restored.value.modifiers.find(item => item.id === "bevel")).toEqual(bevel);
    }
    const evaluator = new ModifierEvaluator();
    const first = await evaluator.evaluate(project, node.id);
    expect(first.ok && first.appliedModifierIds).toEqual(["bevel", "array"]);
    expect(first.warnings.map(warning => warning.code)).toEqual(expect.arrayContaining(["UV_DROPPED", "NORMALS_RECOMPUTED"]));
    const cached = await evaluator.evaluate(project, node.id);
    expect(cached.ok && cached.mesh.indices.length).toBe(first.ok && first.mesh.indices.length);
    bevel.enabled = false;
    const disabled = await evaluator.evaluate(project, node.id);
    expect(disabled.ok && disabled.appliedModifierIds).toEqual(["array"]);
    bevel.enabled = true; bevel.parameters.width = 2; bevel.version++;
    const failed = await evaluator.evaluate(project, node.id);
    expect(failed).toMatchObject({ ok: false, error: { code: "BEVEL_WIDTH_TOO_LARGE" }, fallback: true });
    bevel.enabled = false; bevel.parameters.width = -1;
    expect(validateProject(project).some(issue => issue.path === "modifiers.bevel.parameters")).toBe(true);
    evaluator.dispose();
  });
});
