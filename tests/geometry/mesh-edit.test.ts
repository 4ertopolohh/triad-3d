import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createEditorStore } from "../../src/app/editor-store";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { createCommandBus } from "../../src/domain/command-bus";
import { createProject } from "../../src/domain/create-project";
import { deserializeProjectDocument, serializeProjectDocument } from "../../src/domain/project-serialization";
import type { MeshNode, Project } from "../../src/domain/types";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import { convertPrimitiveToEditable, scaleEditableVertices, translateEditableVertices, validateEditableSource } from "../../src/geometry/mesh-edit";
import { buildMeshTopology } from "../../src/geometry/mesh-topology";
import { vertexRepresentatives } from "../../src/geometry/vertex-selection";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { SceneSync } from "../../src/renderer/scene-sync";
import { generateSpikeTsx, SpikeExportError } from "../../src/spikes/export/generate-tsx";

function fixture(): { project: Project; mesh: MeshNode } {
  let id = 0;
  const project = createProject(() => `id-${++id}`);
  const root = project.nodes[0]!;
  const mesh = createPrimitiveNode("cube", root.id, "cube");
  root.children.push(mesh.id); project.nodes.push(mesh);
  return { project, mesh };
}
const convert = () => ({ commandId: "convert", type: "CONVERT_PRIMITIVE_TO_EDITABLE" as const, targetIds: ["cube"] as [string], payload: { nodeId: "cube" } });
const translate = (vertexIndices: number[], delta: [number, number, number], commandId = "move") =>
  ({ commandId, type: "TRANSLATE_EDITABLE_VERTICES" as const, targetIds: ["cube"] as [string], payload: { nodeId: "cube", vertexIndices, delta } });
const scale = (vertexIndices: number[], factors: [number, number, number], commandId = "scale") =>
  ({ commandId, type: "SCALE_EDITABLE_VERTICES" as const, targetIds: ["cube"] as [string], payload: { nodeId: "cube", vertexIndices, factors } });

describe("editable mesh scaling", () => {
  const cube = () => convertPrimitiveToEditable(createPrimitiveNode("cube", "root", "cube").meshSource as Extract<MeshNode["meshSource"], { kind: "primitive" }>);

  it("scales two unique vertices around one center, preserves seams, UV, indices and input", () => {
    const source = cube();
    const original = structuredClone(source);
    const [a, b] = vertexRepresentatives(source);
    const center = [0, 1, 2].map(axis => (source.positions[3 * a! + axis]! + source.positions[3 * b! + axis]!) / 2);
    const result = scaleEditableVertices(source, [b!, a!, a!], [1.25, 1.5, 1.75]);
    for (const index of [a!, b!]) {
      const before = source.positions.slice(3 * index, 3 * index + 3);
      const duplicates = Array.from({ length: source.positions.length / 3 }, (_, i) => i)
        .filter(i => source.positions.slice(3 * i, 3 * i + 3).every((value, axis) => value === before[axis]));
      for (const duplicate of duplicates) for (let axis = 0; axis < 3; axis++)
        expect(result.positions[3 * duplicate + axis]).toBeCloseTo(Math.fround(center[axis]! + (before[axis]! - center[axis]!) * [1.25, 1.5, 1.75][axis]!));
    }
    expect(result.indices).toEqual(source.indices);
    expect(result.uv).toEqual(source.uv);
    expect(source).toEqual(original);
    expect(validateEditableSource(result)).toBeNull();
  });

  it("scales edge and connected face vertices with one shared center", () => {
    const source = cube();
    const topology = buildMeshTopology(source)!;
    for (const selected of [topology.edges[0]!.vertices, topology.faces[0]!.vertices,
      [...topology.faces[0]!.vertices, ...topology.edges[1]!.vertices]]) {
      const unique = [...new Set(selected)];
      const center = [0, 1, 2].map(axis => unique.reduce((sum, index) => sum + source.positions[3 * index + axis]!, 0) / unique.length);
      const result = scaleEditableVertices(source, selected, [1.1, 1.2, 1.3]);
      for (const index of unique) for (let axis = 0; axis < 3; axis++)
        expect(result.positions[3 * index + axis]).toBeCloseTo(Math.fround(center[axis]! + (source.positions[3 * index + axis]! - center[axis]!) * [1.1, 1.2, 1.3][axis]!));
      expect(validateEditableSource(result)).toBeNull();
    }
  });

  it("returns the same source for semantic and effective no-ops", () => {
    const source = cube();
    const [a, b] = vertexRepresentatives(source);
    expect(scaleEditableVertices(source, [a!, b!], [1, 1, 1])).toBe(source);
    expect(scaleEditableVertices(source, [a!], [2, 2, 2])).toBe(source);
    const axis = [0, 1, 2].find(i => source.positions[3 * a! + i] === source.positions[3 * b! + i])!;
    const factors: [number, number, number] = [1, 1, 1]; factors[axis] = 2;
    expect(scaleEditableVertices(source, [a!, b!], factors)).toBe(source);
  });

  it("rejects malformed factors, selections, overflow and degenerate results atomically", () => {
    const source = cube();
    const before = structuredClone(source);
    for (const selection of [[], [999], [-1], [0.5]]) expect(() => scaleEditableVertices(source, selection, [2, 1, 1])).toThrow();
    for (const factors of [[NaN, 1, 1], [Infinity, 1, 1], [0, 1, 1], [-1, 1, 1], [1e300, 1, 1], [1, 1]] as [number, number, number][])
      expect(() => scaleEditableVertices(source, vertexRepresentatives(source), factors)).toThrow();
    expect(() => scaleEditableVertices(source, vertexRepresentatives(source), [1e-20, 1, 1])).toThrow(/вырожденный/i);
    expect(source).toEqual(before);
  });

  it("commits one reversible patch and keeps invalid edits out of history", async () => {
    const store = createEditorStore(fixture().project);
    const converted = store.executeCommand(convert(), 0);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const initial = store.getSnapshot();
    const source = (initial.document.project.nodes.find(n => n.id === "cube") as MeshNode).meshSource;
    if (source.kind !== "editable") throw new Error("fixture");
    const vertices = vertexRepresentatives(source);
    for (const command of [scale(vertices, [0, 1, 1]), scale([999], [2, 1, 1]), scale(vertices, [NaN, 1, 1])])
      expect(store.executeCommand(command, 1).ok).toBe(false);
    expect(store.getSnapshot()).toBe(initial);
    const noOp = store.executeCommand(scale(vertices, [1, 1, 1]), 1);
    expect(noOp.ok && !noOp.changed).toBe(true);
    expect(store.getSnapshot()).toBe(initial);
    expect(store.executeCommand(scale(vertices, [1.2, 1, 1]), 0).ok).toBe(false);
    const sync = new SceneSync(() => {});
    const epoch = {};
    sync.sync(converted.project, () => undefined, epoch);
    const oldGeometry = (sync.objects.get("cube")!.content as T.Mesh).geometry;
    const disposed = vi.spyOn(oldGeometry, "dispose");
    const result = store.executeCommand(scale(vertices, [1.2, 1, 1]), 1);
    expect(result.ok && result.changed).toBe(true);
    if (!result.ok) return;
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    const changed = result.project;
    sync.sync(changed, () => undefined, epoch);
    expect(disposed).toHaveBeenCalledOnce();
    const rendered = (sync.objects.get("cube")!.content as T.Mesh).geometry;
    const changedSource = (changed.nodes.find(n => n.id === "cube") as MeshNode).meshSource;
    if (changedSource.kind !== "editable") throw new Error("fixture");
    expect((rendered.getAttribute("position") as T.BufferAttribute).getX(vertices[0]!)).toBe(changedSource.positions[3 * vertices[0]!]!);
    expect(store.undo(2).ok).toBe(true);
    expect((store.getSnapshot().document.project.nodes.find(n => n.id === "cube") as MeshNode).meshSource).toEqual(source);
    expect(store.redo(3).ok).toBe(true);
    expect(store.getSnapshot().document.project).toEqual(changed);
    const archive = await createNativeProjectArchive(changed, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (archive.ok) {
      const opened = await openNativeProjectArchive(archive.value);
      expect(opened.ok && opened.value.project).toEqual(changed);
    }
    sync.dispose();
  });

  it("rejects malformed commands, hidden or locked ancestors and active modifiers", () => {
    const converted = createCommandBus(fixture().project).executeCommand(convert(), 0);
    if (!converted.ok) throw new Error(converted.message);
    const source = (converted.project.nodes.find(n => n.id === "cube") as MeshNode).meshSource;
    if (source.kind !== "editable") throw new Error("fixture");
    const vertices = vertexRepresentatives(source);
    const bus = createCommandBus(converted.project);
    const before = bus.getSnapshot();
    for (const invalid of [
      { ...scale(vertices, [2, 1, 1]), targetIds: ["other"] },
      { ...scale(vertices, [2, 1, 1]), payload: { nodeId: "cube", vertexIndices: vertices, factors: [2, 1] } },
      { ...scale(vertices, [2, 1, 1]), payload: { nodeId: "cube", vertexIndices: vertices, factors: [2, 1, 1], extra: true } },
    ]) expect(bus.executeCommand(invalid as unknown as Parameters<typeof bus.executeCommand>[0], 0).ok).toBe(false);
    expect(bus.getSnapshot()).toEqual(before);
    for (const field of ["locked", "visible"] as const) {
      const project = structuredClone(converted.project);
      project.nodes[0]![field] = field === "locked";
      const restricted = createCommandBus(project);
      expect(restricted.executeCommand(scale(vertices, [1.2, 1, 1]), 0).ok).toBe(false);
    }
    const withModifier = structuredClone(converted.project);
    (withModifier.nodes.find(n => n.id === "cube") as MeshNode).modifierIds.push("mirror");
    withModifier.modifiers.push({ id: "mirror", nodeId: "cube", kind: "mirror", order: 0, enabled: true, version: 0,
      parameters: { axes: "x", pivot: [0, 0, 0], mergeSeam: false } });
    const restricted = createCommandBus(withModifier);
    expect(restricted.executeCommand(scale(vertices, [1.2, 1, 1]), 0).ok).toBe(false);
    expect(restricted.getSnapshot()).toEqual(withModifier);
    const withDependent = structuredClone(converted.project);
    const root = withDependent.nodes[0]!;
    const target = createPrimitiveNode("cube", root.id, "target");
    target.modifierIds.push("boolean");
    root.children.push(target.id);
    withDependent.nodes.push(target);
    withDependent.modifiers.push({ id: "boolean", nodeId: target.id, kind: "boolean", order: 0, enabled: true, version: 0,
      parameters: { operation: "subtract", cutterNodeId: "cube" } });
    const dependent = createCommandBus(withDependent);
    expect(dependent.executeCommand(scale(vertices, [1.2, 1, 1]), 0).ok).toBe(false);
    expect(dependent.getSnapshot()).toEqual(withDependent);
  });
});

describe("editable mesh foundation", () => {
  it.each(["cube", "sphere", "torus", "cylinder", "cone"] as const)("converts valid closed %s primitive", kind => {
    const source = createPrimitiveNode(kind, "root", "mesh").meshSource;
    if (source.kind !== "primitive") throw new Error("fixture");
    expect(validateEditableSource(convertPrimitiveToEditable(source))).toBeNull();
  });
  it("diagnoses open primitive conversion", () => {
    const source = createPrimitiveNode("plane", "root", "mesh").meshSource;
    if (source.kind !== "primitive") throw new Error("fixture");
    expect(() => convertPrimitiveToEditable(source)).toThrow(/Плоскость/);
  });
  it("converts cube with UV seams and moves every matching render vertex without changing input", () => {
    const { mesh } = fixture();
    if (mesh.meshSource.kind !== "primitive") throw new Error("fixture");
    const original = structuredClone(mesh.meshSource);
    const source = convertPrimitiveToEditable(mesh.meshSource);
    expect(mesh.meshSource).toEqual(original);
    expect(source.positions.length).toBe(72);
    expect(source.uv?.length).toBe(48);
    const point = source.positions.slice(0, 3);
    const duplicates = Array.from({ length: source.positions.length / 3 }, (_, i) => i)
      .filter(i => source.positions.slice(3 * i, 3 * i + 3).every((v, axis) => v === point[axis]));
    expect(duplicates.length).toBeGreaterThan(1);
    const moved = translateEditableVertices(source, [0, 0, duplicates[1]!], [0.1, 0, 0]);
    expect(validateEditableSource(moved)).toBeNull();
    expect(moved.indices).toEqual(source.indices);
    expect(moved.uv).toEqual(source.uv);
    for (const i of duplicates) expect(moved.positions[3 * i]).toBeCloseTo(point[0]! + 0.1);
    expect(source.positions.slice(0, 3)).toEqual(point);
    const again = translateEditableVertices(moved, [duplicates[0]!], [0, 0.1, 0]);
    expect(again.positions[1]).toBeCloseTo(point[1]! + 0.1);
    expect(translateEditableVertices(again, [0], [0, 0, 0])).toBe(again);
  });

  it("rejects bad selection, nonfinite values, overflow and degenerate triangles", () => {
    const { mesh } = fixture();
    if (mesh.meshSource.kind !== "primitive") throw new Error("fixture");
    const source = convertPrimitiveToEditable(mesh.meshSource);
    expect(() => translateEditableVertices(source, [], [1, 0, 0])).toThrow();
    expect(() => translateEditableVertices(source, [999], [1, 0, 0])).toThrow();
    expect(() => translateEditableVertices(source, [0], [Infinity, 0, 0])).toThrow();
    expect(validateEditableSource({ ...source, indices: [0, 1, 999] })).not.toBeNull();
    expect(validateEditableSource({ ...source, positions: [NaN, ...source.positions.slice(1)] })).not.toBeNull();
    const a = source.indices[0]!, b = source.indices[1]!;
    const delta: [number, number, number] = [0, 1, 2].map(axis => source.positions[3 * b + axis]! - source.positions[3 * a + axis]!) as [number, number, number];
    expect(() => translateEditableVertices(source, [a], delta)).toThrow(/вырожденный/i);
    expect(validateEditableSource(source)).toBeNull();
  });

  it("commits semantic commands, rejects stale/invalid edits, and replays patches", () => {
    const bus = createCommandBus(fixture().project);
    const first = bus.executeCommand(convert(), 0);
    expect(first.ok && first.changed).toBe(true);
    if (!first.ok) return;
    const mesh = first.project.nodes.find(n => n.id === "cube") as MeshNode;
    expect(mesh.meshSource.kind).toBe("editable");
    const unchanged = bus.getSnapshot();
    expect(bus.executeCommand(translate([999], [1, 0, 0]), 1).ok).toBe(false);
    expect(bus.executeCommand(translate([0], [NaN, 0, 0]), 1).ok).toBe(false);
    expect(bus.executeCommand(translate([0], [1, 0, 0]), 0).ok).toBe(false);
    expect(bus.getSnapshot()).toEqual(unchanged);
    const noOp = bus.executeCommand(translate([0], [0, 0, 0]), 1);
    expect(noOp.ok && noOp.changed).toBe(false);
    const moved = bus.executeCommand(translate([0, 0], [0.1, 0, 0]), 1);
    expect(moved.ok && moved.changed).toBe(true);
    if (!moved.ok) return;
    expect(moved.project.model.revision).toBe(2);
    const undoMove = bus.applyHistoryPatch(moved.undoPatch, 2);
    expect(undoMove.ok && undoMove.project).toEqual(unchanged);
    const redoMove = bus.applyHistoryPatch(moved.patch, 3);
    expect(redoMove.ok && redoMove.project).toEqual(moved.project);
    const undoAgain = bus.applyHistoryPatch(moved.undoPatch, 4);
    expect(undoAgain.ok).toBe(true);
    const undoConvert = bus.applyHistoryPatch(first.undoPatch, 5);
    expect(undoConvert.ok && (undoConvert.project.nodes.find(n => n.id === "cube") as MeshNode).meshSource.kind).toBe("primitive");
    expect(bus.applyHistoryPatch(first.patch, 6).ok).toBe(true);
  });

  it("respects inherited lock/visibility and active modifier dependencies", () => {
    const { project, mesh } = fixture();
    project.nodes[0]!.locked = true;
    expect(createCommandBus(project).executeCommand(convert(), 0).ok).toBe(false);
    project.nodes[0]!.locked = false;
    project.nodes[0]!.visible = false;
    expect(createCommandBus(project).executeCommand(convert(), 0).ok).toBe(false);
    project.nodes[0]!.visible = true;
    mesh.modifierIds.push("mirror");
    project.modifiers.push({ id: "mirror", nodeId: mesh.id, kind: "mirror", order: 0, enabled: false, version: 0, parameters: { axes: "x", pivot: [0, 0, 0], mergeSeam: false } });
    const bus = createCommandBus(project);
    expect(bus.executeCommand(convert(), 0).ok).toBe(true);
    const after = bus.getSnapshot();
    after.modifiers[0]!.enabled = true;
    const active = createCommandBus(after);
    expect(active.executeCommand(translate([0], [0.1, 0, 0]), 0).ok).toBe(false);
    expect(active.getSnapshot()).toEqual(after);
    const noOp = active.executeCommand(translate([0], [0, 0, 0]), 0);
    expect(noOp.ok && noOp.changed).toBe(false);
  });

  it("publishes one history step per edit and no state change on rejection", () => {
    const store = createEditorStore(fixture().project);
    const start = store.getSnapshot();
    expect(store.executeCommand(translate([0], [1, 0, 0]), 0).ok).toBe(false);
    expect(store.getSnapshot()).toBe(start);
    expect(store.executeCommand(convert(), 0).ok).toBe(true);
    const converted = store.getSnapshot();
    expect(converted.history.entries).toHaveLength(1);
    expect(converted.derived.generation).toBe(1);
    expect(converted.document.dirty).toBe(true);
    expect(store.executeCommand(translate([0], [0, 0, 0]), 1).ok).toBe(true);
    expect(store.getSnapshot()).toBe(converted);
    expect(store.executeCommand(translate([999], [1, 0, 0]), 1).ok).toBe(false);
    expect(store.getSnapshot()).toBe(converted);
    expect(store.executeCommand(translate([0], [0.1, 0, 0]), 1).ok).toBe(true);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(store.getSnapshot().derived.generation).toBe(2);
    expect(store.undo(2).ok).toBe(true);
    expect(store.undo(3).ok).toBe(true);
    expect(store.getSnapshot().document.dirty).toBe(false);
    expect(store.redo(4).ok).toBe(true);
    expect(store.redo(5).ok).toBe(true);
  });

  it("round trips v1.1 JSON and ZIP, and migrates strict v1 without changing model data", async () => {
    const { project } = fixture();
    const old = structuredClone(project);
    old.schemaVersion = "1.0.0";
    const migrated = deserializeProjectDocument(JSON.stringify(old));
    expect(migrated.ok && migrated.value).toEqual(project);
    const oldWithEditable = structuredClone(old);
    (oldWithEditable.nodes.find(n => n.id === "cube") as MeshNode).meshSource = convertPrimitiveToEditable(fixture().mesh.meshSource as Extract<MeshNode["meshSource"], { kind: "primitive" }>);
    expect(deserializeProjectDocument(JSON.stringify(oldWithEditable)).ok).toBe(false);
    const bus = createCommandBus(project);
    const first = bus.executeCommand(convert(), 0);
    if (!first.ok) throw new Error(first.message);
    const second = bus.executeCommand(translate([0], [0.1, 0, 0]), 1);
    if (!second.ok) throw new Error(second.message);
    const json = serializeProjectDocument(second.project);
    expect(json.ok).toBe(true);
    if (json.ok) expect(deserializeProjectDocument(json.value)).toEqual({ ok: true, value: second.project });
    const archive = await createNativeProjectArchive(second.project, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (archive.ok) {
      const opened = await openNativeProjectArchive(archive.value);
      expect(opened.ok && opened.value.project).toEqual(second.project);
    }
    const invalid = structuredClone(second.project);
    (invalid.nodes.find(n => n.id === "cube") as MeshNode).meshSource = { kind: "editable", positions: [0, 0, 0], indices: [0, 1, 2] };
    expect(deserializeProjectDocument(JSON.stringify(invalid)).ok).toBe(false);
  });

  it("refreshes renderer and evaluator from the domain source, and spike export rejects it", async () => {
    const bus = createCommandBus(fixture().project);
    const first = bus.executeCommand(convert(), 0);
    if (!first.ok) throw new Error(first.message);
    const sync = new SceneSync(() => {});
    const epoch = {};
    sync.sync(first.project, () => undefined, epoch);
    const wrapper = sync.objects.get("cube")!.object;
    const oldGeometry = (sync.objects.get("cube")!.content as T.Mesh).geometry;
    const disposed = vi.spyOn(oldGeometry, "dispose");
    const ray = new T.Ray(new T.Vector3(0, 0, 10), new T.Vector3(0, 0, -1));
    expect(sync.surfaces.nearest(ray)?.mesh.geometry).toBe(oldGeometry);
    const evaluator = new ModifierEvaluator();
    const originalEvaluation = await evaluator.evaluate(first.project, "cube");
    expect(originalEvaluation.ok).toBe(true);
    const moved = bus.executeCommand(translate([0], [0.1, 0, 0]), 1);
    if (!moved.ok) throw new Error(moved.message);
    sync.sync(moved.project, () => undefined, epoch);
    expect(disposed).toHaveBeenCalledOnce();
    expect(sync.objects.get("cube")!.object).toBe(wrapper);
    const rendered = (sync.objects.get("cube")!.content as T.Mesh).geometry;
    expect(sync.surfaces.nearest(ray)?.mesh.geometry).toBe(rendered);
    expect((rendered.getAttribute("position") as T.BufferAttribute).getX(0)).toBeCloseTo(((moved.project.nodes.find(n => n.id === "cube") as MeshNode).meshSource as Extract<MeshNode["meshSource"], { kind: "editable" }>).positions[0]!);
    const before = JSON.stringify(moved.project);
    const evaluated = await evaluator.evaluate(moved.project, "cube");
    expect(evaluated.ok).toBe(true);
    if (originalEvaluation.ok && evaluated.ok) expect(evaluated.mesh.positions[0]).not.toBe(originalEvaluation.mesh.positions[0]);
    if (evaluated.ok) evaluated.mesh.positions[0] = 999;
    const again = await evaluator.evaluate(moved.project, "cube");
    expect(again.ok && again.mesh.positions[0]).not.toBe(999);
    expect(JSON.stringify(moved.project)).toBe(before);
    expect(() => generateSpikeTsx(moved.project)).toThrow(SpikeExportError);
    const undo = bus.applyHistoryPatch(moved.undoPatch, 2);
    if (!undo.ok) throw new Error(undo.message);
    sync.sync(undo.project, () => undefined, epoch);
    expect(sync.surfaces.nearest(ray)?.mesh.geometry).toBe((sync.objects.get("cube")!.content as T.Mesh).geometry);
    const evaluatedUndo = await evaluator.evaluate(undo.project, "cube");
    if (originalEvaluation.ok && evaluatedUndo.ok) expect(evaluatedUndo.mesh.positions).toEqual(originalEvaluation.mesh.positions);
    evaluator.dispose(); sync.dispose();
  });
});
