import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { createEditorStore } from "../../src/app/editor-store";
import { createCommandBus } from "../../src/domain/command-bus";
import { deserializeProjectDocument, serializeProjectDocument } from "../../src/domain/project-serialization";
import type { MeshNode, Project } from "../../src/domain/types";
import { buildMeshTopology } from "../../src/geometry/mesh-topology";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { createNestedMeshProject } from "../fixtures/projects";
import { SceneSync } from "../../src/renderer/scene-sync";

function setup() {
  const store = createEditorStore(createNestedMeshProject());
  store.setSelection(["mesh-node"]);
  const convert = store.executeCommand({ commandId: "convert", type: "CONVERT_PRIMITIVE_TO_EDITABLE", targetIds: ["mesh-node"], payload: { nodeId: "mesh-node" } }, 0);
  if (!convert.ok) throw new Error(convert.message);
  const source = (store.getSnapshot().document.project.nodes.find(n => n.id === "mesh-node") as MeshNode).meshSource;
  if (source.kind !== "editable") throw new Error("fixture");
  const faceId = buildMeshTopology(source)!.faces[0]!.id;
  const command = (distance: number, id = "extrude") => ({ commandId: id, type: "EXTRUDE_EDITABLE_FACE" as const,
    targetIds: ["mesh-node"] as [string], payload: { nodeId: "mesh-node", faceId, distance } });
  return { store, source, faceId, command };
}

describe("face extrude transaction", () => {
  it("updates the domain and renderer in one history step, clears stale face IDs, undo/redo and archive round trip", async () => {
    const { store, source, faceId, command } = setup();
    const epoch = store.getProjectEpoch();
    expect(store.enterMeshEditMode("face", 1, epoch)).toBeNull();
    expect(store.setSubElementSelection([faceId], 1, epoch)).toBe(true);
    const sync = new SceneSync(() => {});
    sync.sync(store.getSnapshot().document.project, () => undefined, {});
    const previous = (sync.objects.get("mesh-node")!.content as T.Mesh).geometry;
    const dispose = vi.spyOn(previous, "dispose");
    const before = store.getSnapshot();
    expect(store.executeCommand(command(0), 1)).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot()).toBe(before);
    const extruded = store.executeCommand(command(0.25), 1);
    expect(extruded.ok && extruded.changed).toBe(true);
    if (!extruded.ok) return;
    expect(extruded.project.model.revision).toBe(before.document.project.model.revision + 1);
    expect(extruded.project.model.id).toBe(before.document.project.model.id);
    expect(extruded.project.scene.id).toBe(before.document.project.scene.id);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(store.getSnapshot().meshEdit).toMatchObject({ mode: "face", faceIds: [] });
    const edited = (extruded.project.nodes.find(n => n.id === "mesh-node") as MeshNode).meshSource;
    expect(edited.kind).toBe("editable");
    expect(edited).not.toEqual(source);
    sync.sync(extruded.project, () => undefined, {});
    expect(dispose).toHaveBeenCalledOnce();
    expect((sync.objects.get("mesh-node")!.content as T.Mesh).geometry.getAttribute("position").count).toBe(edited.kind === "editable" ? edited.positions.length / 3 : 0);
    const json = serializeProjectDocument(extruded.project);
    expect(json.ok).toBe(true);
    if (json.ok) expect(deserializeProjectDocument(json.value)).toEqual({ ok: true, value: extruded.project });
    const archive = await createNativeProjectArchive(extruded.project, new AssetBytes(), "0.1.0");
    expect(archive.ok).toBe(true);
    if (archive.ok) {
      const opened = await openNativeProjectArchive(archive.value);
      expect(opened.ok && opened.value.project).toEqual(extruded.project);
    }
    expect(store.undo(2).ok).toBe(true);
    expect((store.getSnapshot().document.project.nodes.find(n => n.id === "mesh-node") as MeshNode).meshSource).toEqual(source);
    expect(store.redo(3).ok).toBe(true);
    expect((store.getSnapshot().document.project.nodes.find(n => n.id === "mesh-node") as MeshNode).meshSource).toEqual(edited);
    sync.dispose();
  });

  it("rejects stale, invalid, locked, hidden and modified edits without publishing state", () => {
    const { store, command } = setup();
    const before = store.getSnapshot();
    for (const edit of [command(-1), command(NaN), { ...command(0.25), payload: { ...command(0.25).payload, faceId: 999 } }]) {
      expect(store.executeCommand(edit, 1).ok).toBe(false);
      expect(store.getSnapshot()).toBe(before);
    }
    expect(store.executeCommand(command(0.25), 0).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    for (const field of ["locked", "visible"] as const) {
      const project = structuredClone(before.document.project) as Project;
      project.nodes.find(n => n.id === "nested-group")![field] = field === "locked";
      const bus = createCommandBus(project);
      expect(bus.executeCommand(command(0.25), 0).ok).toBe(false);
    }
    const modified = structuredClone(before.document.project) as Project;
    const mesh = modified.nodes.find(n => n.id === "mesh-node") as MeshNode;
    mesh.modifierIds.push("mirror");
    modified.modifiers.push({ id: "mirror", nodeId: mesh.id, kind: "mirror", order: 0, enabled: true, version: 0,
      parameters: { axes: "x", pivot: [0, 0, 0], mergeSeam: false } });
    expect(createCommandBus(modified).executeCommand(command(0.25), 0).ok).toBe(false);
    const dependent = structuredClone(before.document.project) as Project;
    const root = dependent.nodes.find(n => n.id === dependent.model.rootNodeId)!;
    const target = createPrimitiveNode("cube", root.id, "target");
    target.modifierIds.push("boolean");
    root.children.push(target.id); dependent.nodes.push(target);
    dependent.modifiers.push({ id: "boolean", nodeId: target.id, kind: "boolean", order: 0, enabled: true, version: 0,
      parameters: { operation: "subtract", cutterNodeId: "mesh-node" } });
    expect(createCommandBus(dependent).executeCommand(command(0.25), 0).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
  });
});
