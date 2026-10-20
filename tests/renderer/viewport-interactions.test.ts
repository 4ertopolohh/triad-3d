import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createEditorStore } from "../../src/app/editor-store";
import { ViewportInteractions, editable, localTransform, transformChanged } from "../../src/renderer/viewport-interactions";
import { SceneSync } from "../../src/renderer/scene-sync";
import { createNestedMeshProject } from "../fixtures/projects";

describe("viewport transform safeguards", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses local values under transformed parents and rejects invalid scale/quaternion", () => {
    const parent = new T.Group(); parent.position.set(10, 0, 0); parent.rotation.z = Math.PI / 2;
    const child = new T.Group(); parent.add(child); child.position.set(2, 3, 4);
    expect(localTransform(child)?.position).toEqual([2, 3, 4]);
    child.scale.x = 0;
    expect(localTransform(child)).toBeNull();
    child.scale.x = -1;
    expect(localTransform(child)).toBeNull();
    child.scale.x = 1; child.quaternion.set(NaN, 0, 0, 1);
    expect(localTransform(child)).toBeNull();
  });
  it("ignores numerical noise and equivalent quaternion sign", () => {
    const a = { position: [0, 0, 0] as const, rotationQuat: [0, 0, 0, 1] as const, scale: [1, 1, 1] as const };
    expect(transformChanged(a, { ...a, position: [1e-8, 0, 0], rotationQuat: [0, 0, 0, -1] })).toBe(false);
    expect(transformChanged(a, { ...a, position: [0.5, 0, 0] })).toBe(true);
  });
  it("honors inherited hidden and locked flags, mode, block, and protected root", () => {
    const project = createNestedMeshProject();
    const store = createEditorStore(project);
    expect(editable(store.getSnapshot(), "mesh-node", false)).toBe(true);
    expect(editable(store.getSnapshot(), project.model.rootNodeId, false)).toBe(false);
    expect(editable(store.getSnapshot(), "mesh-node", true)).toBe(false);
    store.setTool({ mode: "scene" });
    expect(editable(store.getSnapshot(), "mesh-node", false)).toBe(false);
    store.setTool({ mode: "model" });
    const revision = store.getSnapshot().document.revision;
    const result = store.executeCommand({ commandId: "lock-parent", type: "SET_NODE_FLAGS", targetIds: ["nested-group"],
      payload: { nodeId: "nested-group", locked: true } }, revision);
    expect(result.ok).toBe(true);
    expect(editable(store.getSnapshot(), "mesh-node", false)).toBe(false);
  });
  it("commits one command per drag and rolls back a revision conflict", () => {
    const document = new EventTarget();
    const canvas = Object.assign(new EventTarget(), {
      style: {}, ownerDocument: document, getRootNode: () => document,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
    }) as unknown as HTMLCanvasElement;
    vi.stubGlobal("window", new EventTarget());
    const store = createEditorStore(createNestedMeshProject());
    const graph = new SceneSync(() => {});
    graph.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch());
    const unsubscribe = store.subscribe(() => graph.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch()));
    store.setSelection(["mesh-node"]); store.setTool({ active: "move" });
    const messages: Array<string | null> = [];
    const interaction = new ViewportInteractions(graph, canvas, store, message => messages.push(message), false);
    const object = graph.objects.get("mesh-node")!.object;
    interaction.gizmo.dispatchEvent({ type: "mouseDown", mode: "translate" });
    object.position.x = 2;
    expect(store.getSnapshot().document.revision).toBe(0);
    interaction.gizmo.dispatchEvent({ type: "mouseUp", mode: "translate" });
    expect(store.getSnapshot().document.revision).toBe(1);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "mesh-node")?.transform.position[0]).toBe(2);
    interaction.gizmo.dispatchEvent({ type: "mouseDown", mode: "translate" });
    object.position.x = 4;
    store.executeCommand({ commandId: "rename", type: "RENAME_NODE", targetIds: ["mesh-node"],
      payload: { nodeId: "mesh-node", name: "Новое имя" } }, 1);
    interaction.gizmo.dispatchEvent({ type: "mouseUp", mode: "translate" });
    expect(store.getSnapshot().document.revision).toBe(2);
    expect(store.getSnapshot().history.entries).toHaveLength(2);
    expect(object.position.x).toBe(2);
    expect(messages.some(message => message?.includes("отменено"))).toBe(true);
    interaction.dispose(); unsubscribe(); graph.dispose();
  });
});
