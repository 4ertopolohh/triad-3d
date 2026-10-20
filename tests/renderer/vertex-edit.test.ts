import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createEditorStore } from "../../src/app/editor-store";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { vertexRepresentatives } from "../../src/geometry/vertex-selection";
import { editableGeometry } from "../../src/geometry/mesh-edit";
import { pickEditableVertex } from "../../src/renderer/vertex-picking";
import { createNestedMeshProject } from "../fixtures/projects";
import { SceneSync } from "../../src/renderer/scene-sync";
import { ViewportInteractions } from "../../src/renderer/viewport-interactions";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";

function editableStore() {
  const store = createEditorStore(createNestedMeshProject());
  store.setSelection(["mesh-node"]);
  expect(store.executeCommand({ commandId: "convert", type: "CONVERT_PRIMITIVE_TO_EDITABLE", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node" } }, 0).ok).toBe(true);
  return store;
}

describe("vertex editing session", () => {
  it("groups cube UV seams and translates domain positions with one undo step", () => {
    const store = editableStore();
    const source = store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node");
    if (source?.kind !== "mesh" || source.meshSource.kind !== "editable") throw new Error("editable fixture");
    expect(source.meshSource.positions.length / 3).toBe(24);
    expect(vertexRepresentatives(source.meshSource)).toHaveLength(8);
    const original = source.meshSource;
    const epoch = store.getProjectEpoch();
    expect(store.enterVertexMode(1, epoch)).toBeNull();
    expect(store.setVertexSelection([0, 0, 8], 1, epoch)).toBe(true);
    expect(store.getSnapshot().meshEdit.vertexIndices.length).toBeLessThanOrEqual(2);
    const representative = store.getSnapshot().meshEdit.vertexIndices[0]!;
    expect(store.setVertexSelection([representative], 1, epoch)).toBe(true);
    const result = store.executeCommand({ commandId: "move", type: "TRANSLATE_EDITABLE_VERTICES", targetIds: ["mesh-node"],
      payload: { nodeId: "mesh-node", vertexIndices: [representative], delta: [0.2, 0, 0] } }, 1);
    expect(result.ok && result.changed).toBe(true);
    const moved = store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node");
    if (moved?.kind !== "mesh" || moved.meshSource.kind !== "editable") throw new Error("editable fixture");
    expect(moved.transform).toEqual(source.transform);
    expect(moved.meshSource.uv).toEqual(original.uv);
    expect(moved.meshSource.indices).toEqual(original.indices);
    expect(moved.meshSource.positions.filter((value, index) => value !== original.positions[index]).length).toBe(3);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(store.undo(2).ok).toBe(true);
    expect(store.getSnapshot().meshEdit.mode).toBe("vertex");
    expect(store.redo(3).ok).toBe(true);
    expect(store.getSnapshot().meshEdit.vertexIndices).toHaveLength(1);
    const saved = store.captureDocument();
    expect(saved.project.nodes.find(node => node.id === "mesh-node")).toEqual(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node"));
    expect(store.replaceProject({ project: saved.project, assets: new AssetBytes() }, saved.identity)).toBe(true);
    expect(store.getSnapshot().meshEdit.mode).toBe("object");
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")).toEqual(saved.project.nodes.find(node => node.id === "mesh-node"));
  });

  it("rejects stale selection, hidden ancestors, scene mode and invalid moves without history", () => {
    const store = editableStore();
    const epoch = store.getProjectEpoch();
    expect(store.enterVertexMode(0, epoch)).toContain("изменился");
    expect(store.enterVertexMode(1, epoch)).toBeNull();
    expect(store.setVertexSelection([999], 1, epoch)).toBe(false);
    expect(store.setVertexSelection([0], 1, epoch)).toBe(true);
    const before = store.getSnapshot();
    expect(store.executeCommand({ commandId: "bad", type: "TRANSLATE_EDITABLE_VERTICES", targetIds: ["mesh-node"],
      payload: { nodeId: "mesh-node", vertexIndices: [0], delta: [Infinity, 0, 0] } }, 1).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(store.executeCommand({ commandId: "hide", type: "SET_NODE_FLAGS", targetIds: ["nested-group"],
      payload: { nodeId: "nested-group", visible: false } }, 1).ok).toBe(true);
    expect(store.getSnapshot().meshEdit.mode).toBe("object");
    expect(store.enterVertexMode(2, epoch)).toBeTruthy();
    expect(store.undo(2).ok).toBe(true);
    expect(store.enterVertexMode(3, epoch)).toBeNull();
    store.setTool({ mode: "scene" });
    expect(store.getSnapshot().meshEdit.mode).toBe("object");
    store.setTool({ mode: "model" });
    expect(store.enterVertexMode(3, epoch)).toBeNull();
    store.setSelection([]);
    expect(store.getSnapshot().meshEdit.mode).toBe("object");
  });

  it("uses pointer modifiers for vertex selection and releases temporary markers", () => {
    const dom = new EventTarget();
    const canvas = Object.assign(new EventTarget(), { style: {}, ownerDocument: dom, getRootNode: () => dom,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }) }) as unknown as HTMLCanvasElement;
    vi.stubGlobal("window", new EventTarget());
    const store = editableStore();
    const graph = new SceneSync(() => {});
    const sync = () => graph.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch());
    sync(); const unsubscribe = store.subscribe(sync);
    const interaction = new ViewportInteractions(graph, canvas, store, () => {}, false);
    expect(store.enterVertexMode(1, store.getProjectEpoch())).toBeNull();
    const node = store.getSnapshot().document.project.nodes.find(item => item.id === "mesh-node");
    if (node?.kind !== "mesh" || node.meshSource.kind !== "editable") throw new Error("editable fixture");
    const mesh = graph.objects.get("mesh-node")!.content as T.Mesh;
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index!;
    const hit = { nodeId: "mesh-node", mesh, faceIndex: 0 } as Parameters<typeof pickEditableVertex>[0];
    const nearest = vi.spyOn(graph.surfaces, "nearest").mockReturnValue(hit);
    const handlers = interaction as unknown as { onPointerDown(event: PointerEvent): void; onPointerUp(event: PointerEvent): void; markers: T.Group | null };
    const click = (renderIndex: number, shiftKey = false, ctrlKey = false) => {
      mesh.updateWorldMatrix(true, false);
      const projected = new T.Vector3().fromBufferAttribute(position, renderIndex).applyMatrix4(mesh.matrixWorld).project(graph.camera);
      const event = { button: 0, pointerId: 1, clientX: (projected.x + 1) * 300, clientY: (1 - projected.y) * 200, shiftKey, ctrlKey, metaKey: false } as PointerEvent;
      handlers.onPointerDown(event); handlers.onPointerUp(event);
    };
    click(index.getX(0));
    expect(store.getSnapshot().meshEdit.vertexIndices).toHaveLength(1);
    click(index.getX(1), true);
    expect(store.getSnapshot().meshEdit.vertexIndices).toHaveLength(2);
    click(index.getX(0), false, true);
    expect(store.getSnapshot().meshEdit.vertexIndices).toHaveLength(1);
    expect(handlers.markers?.parent).toBe(graph.objects.get("mesh-node")!.object);
    const meshes = handlers.markers!.children as T.InstancedMesh[];
    expect(meshes.reduce((count, item) => count + item.count, 0)).toBe(8);
    const disposals = meshes.map(item => [vi.spyOn(item.geometry, "dispose"), vi.spyOn(item.material as T.Material, "dispose")] as const);
    nearest.mockReturnValue(null);
    click(index.getX(1));
    expect(store.getSnapshot().meshEdit.vertexIndices).toHaveLength(0);
    store.exitVertexMode();
    expect(handlers.markers).toBeNull();
    expect(disposals.every(([geometry, material]) => geometry.mock.calls.length === 1 && material.mock.calls.length === 1)).toBe(true);
    interaction.dispose(); unsubscribe(); graph.dispose(); vi.unstubAllGlobals();
  });

  it("round trips edited coordinates and UV through the native archive", async () => {
    const store = editableStore();
    expect(store.executeCommand({ commandId: "translate", type: "TRANSLATE_EDITABLE_VERTICES", targetIds: ["mesh-node"],
      payload: { nodeId: "mesh-node", vertexIndices: [0], delta: [0.125, 0, 0] } }, 1).ok).toBe(true);
    const saved = store.captureDocument();
    const archive = await createNativeProjectArchive(saved.project, saved.assets, "0.1.0");
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const opened = await openNativeProjectArchive(archive.value);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.project).toEqual(saved.project);
  });

  it("picks a transformed triangle corner in screen pixels and rejects the face center", () => {
    const source = { kind: "editable" as const, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    const mesh = new T.Mesh(editableGeometry(source));
    const parent = new T.Group(); parent.position.set(2, 1, 0); parent.rotation.z = Math.PI / 4; parent.add(mesh);
    mesh.position.x = 0.5;
    const camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(2, 1, 5); camera.lookAt(2, 1, 0); camera.updateProjectionMatrix();
    mesh.updateWorldMatrix(true, false);
    const rect = { left: 10, top: 20, width: 400, height: 400 };
    const point = new T.Vector3(1, 0, 0).applyMatrix4(mesh.matrixWorld).project(camera);
    const x = rect.left + (point.x + 1) * rect.width / 2;
    const y = rect.top + (1 - point.y) * rect.height / 2;
    const hit = { nodeId: "m", mesh, faceIndex: 0 } as Parameters<typeof pickEditableVertex>[0];
    expect(pickEditableVertex(hit, source, camera, x, y, rect)).toBe(1);
    const center = new T.Vector3(1 / 3, 1 / 3, 0).applyMatrix4(mesh.matrixWorld).project(camera);
    expect(pickEditableVertex(hit, source, camera, rect.left + (center.x + 1) * rect.width / 2,
      rect.top + (1 - center.y) * rect.height / 2, rect)).toBeNull();
    mesh.geometry.dispose();
  });
});
