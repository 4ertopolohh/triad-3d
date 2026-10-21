import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { displaceStroke, brushAffectedVertices, MAX_BRUSH_SAMPLES, MAX_BRUSH_VERTICES } from "../../src/geometry/displace-brush";
import { convertPrimitiveToEditable, validateEditableSource } from "../../src/geometry/mesh-edit";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { SceneSync } from "../../src/renderer/scene-sync";

function fixture() {
  let sequence = 0;
  const project = createProject(() => `id-${++sequence}`);
  const node = createPrimitiveNode("cube", project.model.rootNodeId, "cube");
  project.nodes[0]!.children.push(node.id); project.nodes.push(node);
  const source = convertPrimitiveToEditable(node.meshSource as Extract<typeof node.meshSource, { kind: "primitive" }>);
  return { project, source };
}

describe("Displace Brush", () => {
  it("is deterministic, radial, signed, seam-safe and leaves input/topology untouched", () => {
    const { source } = fixture();
    const before = structuredClone(source);
    const center = source.positions.slice(0, 3) as [number, number, number];
    const samples = [center];
    const positive = displaceStroke(source, samples, 0.35, 0.06);
    const negative = displaceStroke(source, samples, 0.35, -0.06);
    expect(positive).toEqual(displaceStroke(source, samples, 0.35, 0.06));
    expect(positive.positions).not.toEqual(source.positions);
    expect(negative.positions).not.toEqual(positive.positions);
    expect(positive.indices).toEqual(source.indices);
    expect(positive.uv).toEqual(source.uv);
    expect(source).toEqual(before);
    const affected = brushAffectedVertices(source, center, 0.35);
    expect(affected.length).toBeGreaterThan(1);
    for (let i = 0; i < source.positions.length / 3; i++) {
      if (affected.includes(i)) expect(positive.positions.slice(i * 3, i * 3 + 3)).toEqual(positive.positions.slice(0, 3));
      else expect(positive.positions.slice(i * 3, i * 3 + 3)).toEqual(source.positions.slice(i * 3, i * 3 + 3));
    }
    expect(validateEditableSource(positive)).toBeNull();
    const edgePoint: [number, number, number] = [center[0] + 0.2, center[1], center[2]];
    const tapered = displaceStroke(source, [edgePoint], 1.5, 0.06);
    const movement = (i: number) => Math.hypot(...[0, 1, 2].map(axis => tapered.positions[3 * i + axis]! - source.positions[3 * i + axis]!));
    const distances = Array.from({ length: source.positions.length / 3 }, (_, i) => ({ i, d: Math.hypot(...[0, 1, 2].map(axis => source.positions[3 * i + axis]! - edgePoint[axis]!)) }));
    const nearest = distances.reduce((a, b) => a.d < b.d ? a : b);
    const farther = distances.filter(value => value.d < 1.5 && value.d > nearest.d + 0.1).sort((a, b) => a.d - b.d)[0]!;
    expect(movement(nearest.i)).toBeGreaterThan(movement(farther.i));
  });

  it("returns semantic no-ops and rejects invalid input without mutation", () => {
    const { source } = fixture();
    const original = structuredClone(source);
    expect(displaceStroke(source, [[100, 100, 100]], 0.35, 0.06)).toBe(source);
    expect(displaceStroke(source, [[0, 0, 0]], 0.35, 0)).toBe(source);
    for (const [radius, strength] of [[NaN, 0.06], [Infinity, 0.06], [0, 0.06], [11, 0.06], [0.35, 1]])
      expect(() => displaceStroke(source, [[0, 0, 0]], radius!, strength!)).toThrow();
    expect(() => displaceStroke(source, [[Infinity, 0, 0]], 0.35, 0.06)).toThrow();
    expect(() => displaceStroke(source, Array.from({ length: MAX_BRUSH_SAMPLES + 1 }, () => [0, 0, 0]), 0.35, 0.06)).toThrow();
    expect(() => displaceStroke({ kind: "editable", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, [[0, 0, 0]], 0.35, 0.06)).toThrow(/замкнутую/);
    expect(() => displaceStroke({ ...source, positions: Array(MAX_BRUSH_VERTICES * 3 + 3).fill(0) }, [[0, 0, 0]], 0.35, 0.06)).toThrow();
    expect(source).toEqual(original);
  });

  it("mirrors around each mesh-local plane and uses maximum influence in overlaps", () => {
    const { source } = fixture();
    const before = structuredClone(source);
    const point = source.positions.slice(0, 3) as [number, number, number];
    for (const [axis, index] of [["x", 0], ["y", 1], ["z", 2]] as const) {
      const reflected = [...point] as [number, number, number]; reflected[index] *= -1;
      const mirrored = displaceStroke(source, [point], 0.35, 0.06, axis);
      const separate = displaceStroke(source, [point, reflected], 0.35, 0.06);
      expect(mirrored).toEqual(separate);
      expect(brushAffectedVertices(source, point, 0.35, axis)).toEqual(
        brushAffectedVertices(source, point, 0.35).concat(brushAffectedVertices(source, reflected, 0.35))
          .filter((value, position, values) => values.indexOf(value) === position).sort((a, b) => a - b));
      expect(mirrored.positions).not.toEqual(displaceStroke(source, [point], 0.35, 0.06).positions);
      expect(mirrored.indices).toEqual(source.indices);
      expect(mirrored.uv).toEqual(source.uv);
      expect(validateEditableSource(mirrored)).toBeNull();
    }
    const onPlane: [number, number, number] = [0, point[1], point[2]];
    expect(displaceStroke(source, [onPlane], 0.75, 0.06, "x")).toEqual(displaceStroke(source, [onPlane], 0.75, 0.06));
    const overlapping: [number, number, number] = [0.1, point[1], point[2]];
    const reflected: [number, number, number] = [-0.1, point[1], point[2]];
    expect(displaceStroke(source, [overlapping], 1.2, 0.06, "x")).toEqual(displaceStroke(source, [overlapping, reflected, overlapping], 1.2, 0.06));
    expect(displaceStroke(source, [overlapping, overlapping], 1.2, 0.06, "x")).toEqual(displaceStroke(source, [overlapping], 1.2, 0.06, "x"));
    const shifted = { ...source, positions: source.positions.map((value, i) => value + (i % 3 === 0 ? 5 : 0)) };
    const shiftedPoint: [number, number, number] = [point[0] + 5, point[1], point[2]];
    expect(displaceStroke(shifted, [shiftedPoint], 0.35, 0.06, "x")).toEqual(displaceStroke(shifted, [shiftedPoint], 0.35, 0.06));
    expect(source).toEqual(before);
  });

  it("records one reversible command and archives the result", async () => {
    const { project, source } = fixture();
    const node = project.nodes.find(n => n.id === "cube")!;
    if (node.kind !== "mesh") throw new Error("fixture");
    node.meshSource = source;
    const store = createEditorStore(project);
    const scene = new SceneSync(() => {});
    scene.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch());
    const oldGeometry = (scene.objects.get("cube")!.content as T.Mesh).geometry;
    const disposed = vi.spyOn(oldGeometry, "dispose");
    const command = { commandId: "stroke", type: "APPLY_DISPLACE_STROKE" as const, targetIds: ["cube"] as [string],
      payload: { nodeId: "cube", samples: [source.positions.slice(0, 3) as [number, number, number]], radius: 0.35, strength: 0.06 } };
    const result = store.executeCommand(command, 0);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    scene.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch());
    expect(disposed).toHaveBeenCalledOnce();
    const updated = store.getSnapshot().document.project.nodes.find(n => n.id === "cube");
    if (updated?.kind !== "mesh" || updated.meshSource.kind !== "editable") throw new Error("updated fixture");
    expect((scene.objects.get("cube")!.content as T.Mesh).geometry.getAttribute("position").array).toEqual(Float32Array.from(updated.meshSource.positions));
    const changed = store.captureDocument().project;
    expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.captureDocument().project.nodes.find(n => n.id === "cube")).toEqual(node);
    expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.captureDocument().project).toEqual(changed);
    expect(store.executeCommand({ ...command, commandId: "stale" }, 0).ok).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    const archive = await createNativeProjectArchive(changed, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const reopened = await openNativeProjectArchive(archive.value);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.value.project).toEqual(changed);
    const validSymmetric = store.executeCommand({ ...command, commandId: "symmetry", payload: { ...command.payload, symmetry: "x" } }, store.getSnapshot().document.revision);
    expect(validSymmetric).toMatchObject({ ok: true, changed: true });
    const historyLength = store.getSnapshot().history.entries.length;
    const symmetricProject = store.captureDocument().project;
    expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.captureDocument().project).toEqual(symmetricProject);
    const snapshot = store.captureDocument();
    const symmetricArchive = await createNativeProjectArchive(symmetricProject, new AssetBytes(), "0.1.0");
    expect(symmetricArchive.ok).toBe(true);
    if (symmetricArchive.ok) {
      const reopenedSymmetric = await openNativeProjectArchive(symmetricArchive.value);
      expect(reopenedSymmetric.ok && reopenedSymmetric.value.project).toEqual(symmetricProject);
    }
    for (const symmetry of [null, "invalid", 4, undefined]) {
      const invalid = { ...command, commandId: `bad-${String(symmetry)}`, payload: { ...command.payload, symmetry } };
      expect(store.executeCommand(invalid as typeof command, store.getSnapshot().document.revision).ok).toBe(false);
      expect(store.captureDocument()).toEqual(snapshot);
      expect(store.getSnapshot().history.entries).toHaveLength(historyLength);
    }
    expect(store.executeCommand({ ...command, commandId: "extra", payload: { ...command.payload, symmetry: "x", extra: true } } as typeof command,
      store.getSnapshot().document.revision).ok).toBe(false);
    expect(store.captureDocument()).toEqual(snapshot);
    expect(store.getSnapshot().history.entries).toHaveLength(historyLength);
    const noop = store.executeCommand({ ...command, commandId: "noop", payload: { ...command.payload, samples: [[100, 100, 100]], symmetry: "x" } },
      store.getSnapshot().document.revision);
    expect(noop).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(historyLength);
    scene.dispose();
  });
});
