import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { planarUv, boxGeometry, ProjectionGeometry } from "../../src/renderer/planar-projection";
import { SceneSync } from "../../src/renderer/scene-sync";
import { pickEditableVertex } from "../../src/renderer/vertex-picking";
import { createMaterialAnimationProject } from "../fixtures/projects";

describe("baseColor projection", () => {
  it("projects all six face directions with stable ties and without changing source buffers", () => {
    const source = new T.BufferGeometry();
    source.setAttribute("position", new T.Float32BufferAttribute([
      1, 2, 3, 1, 3, 3, 1, 2, 4, // +X
      1, 2, 3, 1, 2, 4, 1, 3, 3, // -X
      1, 2, 3, 1, 2, 4, 2, 2, 3, // +Y
      1, 2, 3, 2, 2, 3, 1, 2, 4, // -Y
      1, 2, 3, 2, 2, 3, 1, 3, 3, // +Z
      1, 2, 3, 1, 3, 3, 2, 2, 3, // -Z
    ], 3));
    const before = [...source.getAttribute("position").array];
    const boxed = boxGeometry(source, { mode: "box", tiling: [2, 3], offset: [4, 5] });
    expect([0, 3, 6, 9, 12, 15].map(i => [boxed.getAttribute("uv").getX(i), boxed.getAttribute("uv").getY(i)]))
      .toEqual([[-2, 11], [10, 11], [6, -4], [6, 14], [6, 11], [2, 11]]);
    expect([...source.getAttribute("position").array]).toEqual(before);
    expect(source.getAttribute("uv")).toBeUndefined();
    boxed.dispose(); source.dispose();
  });
  it("splits shared indexed corners and retains source vertex mapping", () => {
    const source = new T.BufferGeometry();
    source.setAttribute("position", new T.Float32BufferAttribute([1, 2, 3, 2, 2, 3, 1, 3, 3, 1, 2, 4], 3));
    source.setIndex([0, 1, 2, 0, 2, 3]);
    const boxed = boxGeometry(source, { mode: "box", tiling: [1, 1], offset: [0, 0] });
    expect(boxed.index).toBeNull();
    expect([...boxed.userData.sourceVertexIndices]).toEqual([0, 1, 2, 0, 2, 3]);
    expect([boxed.getAttribute("uv").getX(0), boxed.getAttribute("uv").getY(0)])
      .not.toEqual([boxed.getAttribute("uv").getX(3), boxed.getAttribute("uv").getY(3)]);
    expect(source.index?.count).toBe(6);
    const mesh = new T.Mesh(boxed, new T.MeshBasicMaterial());
    const camera = new T.PerspectiveCamera(50, 1, .1, 100);
    camera.position.set(5, 6, 8); camera.lookAt(1, 2, 3); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    mesh.updateMatrixWorld();
    const point = new T.Vector3(1, 2, 4).project(camera);
    expect(pickEditableVertex({ mesh, faceIndex: 1 } as unknown as Parameters<typeof pickEditableVertex>[0],
      { positions: [...source.getAttribute("position").array] }, camera, (point.x + 1) * 50, (1 - point.y) * 50,
      { left: 0, top: 0, width: 100, height: 100 }, 1)).toBe(3);
    expect(() => boxGeometry(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(), new T.Vector3()]), { mode: "box", tiling: [1, 1], offset: [0, 0] })).toThrow(/вырожденный/);
    boxed.dispose(); source.dispose();
  });
  const points = [2, 3, 5, -1, 4, 7, 0, 0, 0];
  it("uses stable local axes and leaves input unchanged", () => {
    const before = [...points];
    expect([...planarUv(points, { mode: "planar", axis: "x", tiling: [2, 3], offset: [1, -1] })]).toEqual([11, 8, 15, 11, 1, -1]);
    expect([...planarUv(points, { mode: "planar", axis: "y", tiling: [1, 1], offset: [0, 0] })]).toEqual([2, 5, -1, 7, 0, 0]);
    expect([...planarUv(points, { mode: "planar", axis: "z", tiling: [1, 1], offset: [0, 0] })]).toEqual([2, 3, -1, 4, 0, 0]);
    expect(points).toEqual(before);
  });
  it("restores authored UV exactly after planar changes", () => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    const authored = new T.Float32BufferAttribute([.1, .2, .3, .4, .5, .6], 2);
    geometry.setAttribute("uv", authored);
    const projection = new ProjectionGeometry();
    const config = { mode: "planar" as const, axis: "x" as const, tiling: [1, 1] as const, offset: [0, 0] as const };
    projection.apply(geometry, config);
    expect([...geometry.getAttribute("uv").array]).toEqual([5, 3, 7, 4, 0, 0]);
    projection.apply(geometry, config);
    expect([...geometry.getAttribute("uv").array]).toEqual([5, 3, 7, 4, 0, 0]);
    projection.apply(geometry, { mode: "uv" });
    expect(geometry.getAttribute("uv")).toBe(authored);
    expect([...geometry.getAttribute("position").array]).toEqual(points);
  });
  it("switches UV, Planar and Box while preserving authored UV and picking indices", () => {
    const project = createMaterialAnimationProject();
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    if (node.kind !== "mesh") throw new Error("fixture");
    node.meshSource = { kind: "editable", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], uv: [0, 0, 1, 0, 0, 1, 1, 1] };
    const sync = new SceneSync(() => {});
    sync.sync(project, () => undefined);
    const mesh = sync.objects.get(node.id)!.content as T.Mesh;
    const authored = mesh.geometry;
    const originalUv = authored.getAttribute("uv");
    project.materials[0]!.textureMappings = { baseColor: { mode: "box", tiling: [1, 1], offset: [0, 0] } };
    sync.sync(project, () => undefined);
    expect(mesh.geometry).not.toBe(authored);
    const boxed = mesh.geometry;
    const boxedDispose = vi.spyOn(boxed, "dispose");
    const authoredDispose = vi.spyOn(authored, "dispose");
    expect([...mesh.geometry.userData.sourceVertexIndices]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.geometry.getAttribute("uv")).toBeDefined();
    project.materials[0]!.textureMappings.baseColor = { mode: "planar", axis: "z", tiling: [1, 1], offset: [0, 0] };
    sync.sync(project, () => undefined);
    expect(mesh.geometry).toBe(authored);
    expect(boxedDispose).toHaveBeenCalledOnce();
    delete project.materials[0]!.textureMappings;
    sync.sync(project, () => undefined);
    expect(mesh.geometry.getAttribute("uv")).toBe(originalUv);
    expect([...authored.getAttribute("position").array]).toEqual(node.meshSource.positions);
    sync.dispose();
    expect(authoredDispose).toHaveBeenCalledOnce();
  });
  it("projects a UV-less editable mesh, updates without rebuilding, and separates samplers", async () => {
    const project = createMaterialAnimationProject();
    const mesh = project.nodes.find(node => node.id === "mesh-node")!;
    if (mesh.kind !== "mesh") throw new Error("fixture");
    mesh.meshSource = { kind: "editable", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    project.assets.push({ id: "image", hash: "a".repeat(64), mediaType: "image/png", path: "assets/image.png", colorSpace: "srgb" });
    project.materials[0]!.textureSlots = { baseColor: "image" };
    project.materials[0]!.textureMappings = { baseColor: { mode: "planar", axis: "z", tiling: [1, 1], offset: [0, 0] } };
    const close = vi.fn(); vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close } as unknown as ImageBitmap));
    try {
      const sync = new SceneSync(() => {});
      sync.sync(project, () => new Uint8Array([1]));
      await Promise.resolve(); await Promise.resolve();
      const content = sync.objects.get("mesh-node")!.content as T.Mesh;
      const geometry = content.geometry;
      expect([...geometry.getAttribute("uv").array]).toEqual([0, 0, 1, 0, 0, 1]);
      expect((content.material as T.MeshPhysicalMaterial).map?.wrapS).toBe(T.RepeatWrapping);
      project.materials[0]!.textureMappings!.baseColor = { mode: "planar", axis: "x", tiling: [2, 1], offset: [0, 0] };
      sync.sync(project, () => new Uint8Array([1]));
      expect(content.geometry).toBe(geometry);
      expect([...geometry.getAttribute("uv").array]).toEqual([0, 0, 0, 0, 0, 1]);
      delete project.materials[0]!.textureMappings;
      sync.sync(project, () => new Uint8Array([1]));
      expect(geometry.getAttribute("uv")).toBeUndefined();
      expect((content.material as T.MeshPhysicalMaterial).map).toBeNull();
      sync.dispose();
      expect(close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps simultaneous UV and Planar samplers independent", async () => {
    const project = createMaterialAnimationProject();
    const original = project.nodes.find(node => node.id === "mesh-node")!;
    const second = structuredClone(original); second.id = "second-mesh";
    project.nodes.push(second); project.nodes.find(node => node.id === "nested-group")!.children.push(second.id);
    const planar = structuredClone(project.materials[0]!); planar.id = "planar-material";
    planar.textureMappings = { baseColor: { mode: "planar", axis: "z", tiling: [1, 1], offset: [0, 0] } };
    project.materials.push(planar);
    second.materialSlots = [{ name: "Основной", materialId: planar.id }];
    project.assets.push({ id: "image", hash: "a".repeat(64), mediaType: "image/png", path: "assets/image.png", colorSpace: "srgb" });
    project.materials[0]!.textureSlots = { baseColor: "image" }; planar.textureSlots = { baseColor: "image" };
    const close = vi.fn(); vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close } as unknown as ImageBitmap));
    try {
      const sync = new SceneSync(() => {}); sync.sync(project, () => new Uint8Array([1]));
      await Promise.resolve(); await Promise.resolve();
      const uvMap = ((sync.objects.get(original.id)!.content as T.Mesh).material as T.MeshPhysicalMaterial).map!;
      const planarMap = ((sync.objects.get(second.id)!.content as T.Mesh).material as T.MeshPhysicalMaterial).map!;
      expect(uvMap).not.toBe(planarMap);
      expect(uvMap.wrapS).toBe(T.ClampToEdgeWrapping);
      expect(planarMap.wrapS).toBe(T.RepeatWrapping);
      sync.dispose(); expect(close).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
  it("projects the current derived mesh and updates it without reevaluation", () => {
    const project = createMaterialAnimationProject();
    const sync = new SceneSync(() => {});
    sync.sync(project, () => undefined);
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
    sync.setDerived("mesh-node", { positions, indices }, false);
    const content = sync.objects.get("mesh-node")!.content as T.Mesh;
    expect(content.geometry.getAttribute("uv")).toBeUndefined();
    project.materials[0]!.textureMappings = { baseColor: { mode: "planar", axis: "y", tiling: [2, 1], offset: [1, 0] } };
    sync.sync(project, () => undefined);
    expect(sync.objects.get("mesh-node")!.content).toBe(content);
    expect([...content.geometry.getAttribute("uv").array]).toEqual([1, 0, 3, 0, 1, 0, 1, 1]);
    project.materials[0]!.textureMappings.baseColor = { mode: "box", tiling: [2, 1], offset: [1, 0] };
    sync.sync(project, () => undefined);
    expect(sync.objects.get("mesh-node")!.content).toBe(content);
    expect(content.geometry.index).toBeNull();
    const boxed = content.geometry;
    project.materials[0]!.roughness = .43;
    sync.sync(project, () => undefined);
    expect(content.geometry).toBe(boxed);
    expect([...positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    delete project.materials[0]!.textureMappings;
    sync.sync(project, () => undefined);
    expect(content.geometry.getAttribute("uv")).toBeUndefined();
    sync.dispose();
  });
});
