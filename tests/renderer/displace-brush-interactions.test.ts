import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { convertPrimitiveToEditable } from "../../src/geometry/mesh-edit";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import type { SurfaceHit } from "../../src/geometry/surface-query";
import { SceneSync } from "../../src/renderer/scene-sync";
import { ViewportInteractions } from "../../src/renderer/viewport-interactions";

describe("brush pointer lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("commits one stroke and cancels Escape without changing history", () => {
    const document = new EventTarget();
    const capture = new Set<number>();
    const canvas = Object.assign(new EventTarget(), {
      style: {}, ownerDocument: document, getRootNode: () => document,
      setPointerCapture: (id: number) => capture.add(id),
      hasPointerCapture: (id: number) => capture.has(id),
      releasePointerCapture: (id: number) => capture.delete(id),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }),
    }) as unknown as HTMLCanvasElement;
    const window = new EventTarget(); vi.stubGlobal("window", window);
    let sequence = 0;
    const project = createProject(() => `id-${++sequence}`);
    const node = createPrimitiveNode("cube", project.model.rootNodeId, "cube");
    node.meshSource = convertPrimitiveToEditable(node.meshSource as Extract<typeof node.meshSource, { kind: "primitive" }>);
    project.nodes[0]!.children.push(node.id); project.nodes.push(node);
    const store = createEditorStore(project); store.setSelection([node.id]); store.setTool({ active: "displace" });
    const graph = new SceneSync(() => {});
    graph.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch());
    const unsubscribe = store.subscribe(() => graph.sync(store.getSnapshot().document.project, () => undefined, store.getProjectEpoch()));
    const source = node.meshSource;
    if (source.kind !== "editable") throw new Error("fixture");
    const local = new T.Vector3(...source.positions.slice(0, 3) as [number, number, number]);
    const hit = { nodeId: node.id, pointNodeLocal: local, pointWorld: local, pointLocal: local, normalWorld: new T.Vector3(0, 1, 0), normalLocal: new T.Vector3(0, 1, 0),
      mesh: new T.Mesh(), distance: 1 } as SurfaceHit;
    vi.spyOn(graph.surfaces, "nearest").mockReturnValue(hit);
    const controller = new ViewportInteractions(graph, canvas, store, () => {}, false);
    const pointer = (type: string, x = 300) => canvas.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x, clientY: 200 }));
    pointer("pointerdown"); pointer("pointermove", 310); pointer("pointerup", 310);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(store.getSnapshot().tool.active).toBe("displace");
    pointer("pointerdown");
    window.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape", ctrlKey: false, metaKey: false, altKey: false }));
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(capture.size).toBe(0);
    controller.dispose(); unsubscribe(); graph.dispose();
  });
});
