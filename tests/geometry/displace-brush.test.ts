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
    scene.dispose();
  });
});
