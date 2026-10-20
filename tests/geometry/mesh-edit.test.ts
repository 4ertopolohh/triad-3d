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
import { convertPrimitiveToEditable, translateEditableVertices, validateEditableSource } from "../../src/geometry/mesh-edit";
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
