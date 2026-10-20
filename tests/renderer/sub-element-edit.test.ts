import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../src/app/editor-store";
import { buildMeshTopology } from "../../src/geometry/mesh-topology";
import { editableGeometry } from "../../src/geometry/mesh-edit";
import { pickEditableEdge } from "../../src/renderer/sub-element-picking";
import { createNestedMeshProject } from "../fixtures/projects";
import * as T from "three";

function setup() {
  const store = createEditorStore(createNestedMeshProject());
  store.setSelection(["mesh-node"]);
  expect(store.executeCommand({ commandId: "convert", type: "CONVERT_PRIMITIVE_TO_EDITABLE", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node" } }, 0).ok).toBe(true);
  const node = store.getSnapshot().document.project.nodes.find(item => item.id === "mesh-node");
  if (node?.kind !== "mesh" || node.meshSource.kind !== "editable") throw new Error("fixture");
  return { store, source: node.meshSource, topology: buildMeshTopology(node.meshSource)! };
}

describe("edge and face editing", () => {
  it.each(["edge", "face"] as const)("translates a selected %s through one command with undo and redo", mode => {
    const { store, source, topology } = setup();
    const epoch = store.getProjectEpoch();
    expect(store.enterMeshEditMode(mode, 1, epoch)).toBeNull();
    const ids = mode === "edge" ? [topology.edges[0]!.id] : [topology.faces[0]!.id];
    expect(store.setSubElementSelection(ids, 1, epoch)).toBe(true);
    const vertices = store.selectedMeshVertices()!;
    expect(vertices.length).toBeGreaterThan(0);
    expect(vertices).toEqual([...new Set(vertices)]);
    const moved = store.executeCommand({ commandId: "move", type: "TRANSLATE_EDITABLE_VERTICES", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node", vertexIndices: vertices, delta: [0.125, 0, 0] } }, 1);
    expect(moved.ok && moved.changed).toBe(true);
    const after = store.getSnapshot().document.project.nodes.find(item => item.id === "mesh-node");
    if (after?.kind !== "mesh" || after.meshSource.kind !== "editable") throw new Error("fixture");
    expect(after.meshSource.positions).not.toEqual(source.positions);
    expect(after.meshSource.indices).toEqual(source.indices);
    expect(after.meshSource.uv).toEqual(source.uv);
    expect(store.undo(2).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(item => item.id === "mesh-node")).toMatchObject({ meshSource: source });
    expect(store.redo(3).ok).toBe(true);
    expect(store.getSnapshot().document.project.nodes.find(item => item.id === "mesh-node")).toMatchObject({ meshSource: after.meshSource });
  });

  it("clears incompatible selection and rejects stale and invalid choices", () => {
    const { store, topology } = setup();
    const epoch = store.getProjectEpoch();
    expect(store.enterMeshEditMode("edge", 1, epoch)).toBeNull();
    expect(store.setSubElementSelection([topology.edges[0]!.id], 1, epoch)).toBe(true);
    expect(store.enterMeshEditMode("face", 1, epoch)).toBeNull();
    expect(store.getSnapshot().meshEdit.edgeIds).toHaveLength(0);
    expect(store.setSubElementSelection([999], 1, epoch)).toBe(false);
    expect(store.setSubElementSelection([topology.faces[0]!.id], 0, epoch)).toBe(false);
    store.setTool({ mode: "scene" });
    expect(store.getSnapshot().meshEdit.mode).toBe("object");
  });

  it("picks only a near segment of the front hit triangle in screen pixels", () => {
    const source = { kind: "editable" as const, positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2] };
    const mesh = new T.Mesh(editableGeometry(source));
    const camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0.5, 0.5, 5); camera.lookAt(0.5, 0.5, 0); camera.updateProjectionMatrix();
    const hit = { nodeId: "mesh", mesh, faceIndex: 0 } as Parameters<typeof pickEditableEdge>[0];
    const midpoint = new T.Vector3(0.5, 0, 0).project(camera);
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    expect(pickEditableEdge(hit, source, buildMeshTopology(source)!, camera, (midpoint.x + 1) * 200, (1 - midpoint.y) * 200, rect)).toBe("0:1");
    expect(pickEditableEdge(hit, source, buildMeshTopology(source)!, camera, 5, 5, rect)).toBeNull();
    mesh.geometry.dispose();
  });

  it("keeps history unchanged for zero, nonfinite and degenerate moves, and blocks hidden parents", () => {
    const { store, topology } = setup();
    const epoch = store.getProjectEpoch();
    expect(store.enterMeshEditMode("edge", 1, epoch)).toBeNull();
    expect(store.setSubElementSelection([topology.edges[0]!.id], 1, epoch)).toBe(true);
    const vertices = store.selectedMeshVertices()!;
    const before = store.getSnapshot();
    const command = (id: string, delta: [number, number, number]) => ({ commandId: id, type: "TRANSLATE_EDITABLE_VERTICES" as const, targetIds: ["mesh-node"], payload: { nodeId: "mesh-node", vertexIndices: vertices, delta } });
    const zero = store.executeCommand(command("zero", [0, 0, 0]), 1);
    expect(zero.ok && !zero.changed).toBe(true);
    expect(store.executeCommand(command("bad", [NaN, 0, 0]), 1).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(store.executeCommand({ commandId: "hide", type: "SET_NODE_FLAGS", targetIds: ["nested-group"], payload: { nodeId: "nested-group", visible: false } }, 1).ok).toBe(true);
    expect(store.getSnapshot().meshEdit.mode).toBe("object");
    expect(store.enterMeshEditMode("face", 2, epoch)).toBeTruthy();
  });
});
