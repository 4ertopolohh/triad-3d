import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createPrimitiveNode, createPrimitiveSource, primitiveDefinitions, validatePrimitiveSource, type PrimitiveKind } from "../../src/geometry/primitives";
import { primitiveGeometry } from "../../src/renderer/primitive";
import { createProject } from "../../src/domain/create-project";
import { createCommandBus } from "../../src/domain/command-bus";
import { validateProject } from "../../src/domain/validate-project";
import { SceneSync } from "../../src/renderer/scene-sync";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import { createEditorStore } from "../../src/app/editor-store";

const kinds = Object.keys(primitiveDefinitions) as PrimitiveKind[];
describe("parametric primitives", () => {
  it.each(kinds)("builds finite indexed %s geometry with normals and UVs", kind => {
    const source = createPrimitiveSource(kind);
    const original = structuredClone(source);
    const geometry = primitiveGeometry(source);
    expect(geometry.index?.count).toBeGreaterThan(0);
    for (const attribute of ["position", "normal", "uv"]) {
      const data = geometry.getAttribute(attribute) as T.BufferAttribute;
      expect(data.count).toBeGreaterThan(0);
      expect(Array.from(data.array).every(Number.isFinite)).toBe(true);
    }
    expect(source).toEqual(original);
    expect(primitiveGeometry(source).getAttribute("position").array).toEqual(geometry.getAttribute("position").array);
    geometry.dispose();
  });
  it("rejects invalid dimensions, segments, unknown keys and degenerate cylinders", () => {
    for (const value of [NaN, Infinity, -1, 0]) expect(validatePrimitiveSource({ kind: "primitive", primitive: "sphere", parameters: { radius: value } })).toBeTruthy();
    for (const value of [2.5, 129]) expect(validatePrimitiveSource({ kind: "primitive", primitive: "sphere", parameters: { widthSegments: value } })).toBeTruthy();
    expect(validatePrimitiveSource({ kind: "primitive", primitive: "cube", parameters: { unsupported: 1 } })).toBeTruthy();
    expect(validatePrimitiveSource({ kind: "primitive", primitive: "cylinder", parameters: { radiusTop: 0, radiusBottom: 0 } })).toBeTruthy();
    expect(validatePrimitiveSource({ kind: "primitive", primitive: "cylinder", parameters: { radiusTop: 0, radiusBottom: 1 } })).toBeNull();
  });
  it("rejects parameter edits on an asset-backed mesh without changing revision", () => {
    const project = createProject((() => { let n = 0; return () => `asset-project-${++n}`; })());
    project.assets.push({ id: "asset-1", hash: "f".repeat(64), mediaType: "model/gltf-binary", path: `assets/${"f".repeat(64)}.glb`, colorSpace: "none" });
    const node = createPrimitiveNode("cube", project.model.rootNodeId, "asset-mesh");
    node.meshSource = { kind: "asset", assetId: "asset-1" };
    project.nodes.push(node);
    project.nodes[0]!.children.push(node.id);
    const bus = createCommandBus(project);
    expect(bus.executeCommand({ commandId: "edit-asset", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source: createPrimitiveSource("cube") } }, 0))
      .toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(bus.getRevision()).toBe(0);
    expect(bus.getSnapshot()).toEqual(project);
  });
  it("keeps failed edits out of store history and replays successful parameter edits", () => {
    const project = createProject((() => { let n = 0; return () => `store-${++n}`; })());
    const store = createEditorStore(project);
    const node = createPrimitiveNode("sphere", project.model.rootNodeId, "sphere-node");
    expect(store.executeCommand({ commandId: "add", type: "ADD_NODE", targetIds: [project.model.rootNodeId, node.id], payload: { parentId: project.model.rootNodeId, node } }, 0).ok).toBe(true);
    const source = { kind: "primitive" as const, primitive: "sphere" as const, parameters: { radius: 2, widthSegments: 32, heightSegments: 16 } };
    expect(store.executeCommand({ commandId: "bad", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source: { ...source, parameters: { ...source.parameters, radius: NaN } } } }, 1).ok).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.getSnapshot().document.revision).toBe(1);
    expect(store.executeCommand({ commandId: "edit", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source } }, 1).ok).toBe(true);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(store.undo(2).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(n => n.id === node.id)).toMatchObject({ meshSource: { parameters: { radius: 1 } } });
    expect(store.redo(3).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(n => n.id === node.id)).toMatchObject({ meshSource: { parameters: { radius: 2 } } });
  });
  it("adds, edits, replays and renders without rebuilding on transforms", () => {
    const project = createProject((() => { let n = 0; return () => `id-${++n}`; })());
    const bus = createCommandBus(project);
    const node = createPrimitiveNode("cube", project.model.rootNodeId, "cube-1");
    const added = bus.executeCommand({ commandId: "add", type: "ADD_NODE", targetIds: [project.model.rootNodeId, node.id], payload: { parentId: project.model.rootNodeId, node } }, 0);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const sync = new SceneSync(() => {});
    sync.sync(added.project, () => undefined);
    const first = (sync.objects.get(node.id)!.content as T.Mesh).geometry;
    const disposed = vi.spyOn(first, "dispose");
    const source = { kind: "primitive" as const, primitive: "cube" as const, parameters: { size: 2 } };
    const edited = bus.executeCommand({ commandId: "edit", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source } }, 1);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(validateProject(edited.project)).toEqual([]);
    const serialized = serializeProjectDocument(edited.project);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) expect(deserializeProjectDocument(serialized.value)).toEqual({ ok: true, value: edited.project });
    sync.sync(edited.project, () => undefined);
    expect(disposed).toHaveBeenCalledOnce();
    const second = (sync.objects.get(node.id)!.content as T.Mesh).geometry;
    expect((second as T.BoxGeometry).parameters.width).toBe(2);
    const noop = bus.executeCommand({ commandId: "same", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source } }, 2);
    expect(noop).toMatchObject({ ok: true, changed: false, revision: 2 });
    const invalid = bus.executeCommand({ commandId: "bad", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source: { ...source, parameters: { size: -1 } } } }, 2);
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(bus.getRevision()).toBe(2);
    expect(bus.executeCommand({ commandId: "wrong-type", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source: createPrimitiveSource("sphere") } }, 2))
      .toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    const locked = bus.executeCommand({ commandId: "lock", type: "SET_NODE_FLAGS", targetIds: [node.id], payload: { nodeId: node.id, locked: true } }, 2);
    expect(locked.ok).toBe(true);
    expect(bus.executeCommand({ commandId: "locked-edit", type: "SET_PRIMITIVE_PARAMETERS", targetIds: [node.id], payload: { nodeId: node.id, source } }, 3))
      .toMatchObject({ ok: false, code: "NODE_LOCKED" });
    if (!locked.ok) return;
    expect(bus.applyHistoryPatch(locked.undoPatch, 3).ok).toBe(true);
    expect(bus.applyHistoryPatch(edited.undoPatch, 4).ok).toBe(true);
    expect(bus.getSnapshot().nodes.find(n => n.id === node.id)).toMatchObject({ meshSource: { parameters: { size: 1 } } });
    expect(bus.applyHistoryPatch(edited.patch, 5).ok).toBe(true);
    sync.sync(bus.getSnapshot(), () => undefined);
    const stable = (sync.objects.get(node.id)!.content as T.Mesh).geometry;
    const moved = bus.executeCommand({ commandId: "move", type: "SET_NODE_TRANSFORM", targetIds: [node.id], payload: { nodeId: node.id, transform: { ...node.transform, position: [1, 0, 0] } } }, 6);
    if (!moved.ok) throw new Error(moved.message);
    sync.sync(moved.project, () => undefined);
    expect((sync.objects.get(node.id)!.content as T.Mesh).geometry).toBe(stable);
    sync.sync(project, () => undefined);
    expect(sync.objects.has(node.id)).toBe(false);
    sync.dispose();
  });
});
