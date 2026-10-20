import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { SurfaceQuery } from "../../src/geometry/surface-query";
import { primitiveGeometry } from "../../src/renderer/primitive";
import { SceneSync } from "../../src/renderer/scene-sync";
import { createEditorStore } from "../../src/app/editor-store";
import { createNestedMeshProject } from "../fixtures/projects";

const ray = (x = 0, y = 0) => new T.Ray(new T.Vector3(x, y, 10), new T.Vector3(0, 0, -1));
const near = (a: T.Vector3, b: T.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-5);
function triangle(indexed = true, uv = true): T.BufferGeometry {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
  if (indexed) geometry.setIndex([0, 1, 2]);
  if (uv) geometry.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2));
  return geometry;
}
function mount(query: SurfaceQuery, geometry: T.BufferGeometry, nodeId = "node") {
  const scene = new T.Scene(); const wrapper = new T.Group(); const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
  scene.add(wrapper); wrapper.add(mesh); scene.updateMatrixWorld(true); query.register(nodeId, wrapper, mesh);
  return { scene, wrapper, mesh };
}

describe("surface queries", () => {
  it("matches standard Three raycast on indexed and non-indexed triangles, including UV and no-hit", () => {
    for (const indexed of [true, false]) for (const uv of [true, false]) {
      const query = new SurfaceQuery(); const { mesh } = mount(query, triangle(indexed, uv));
      const standard = T.Mesh.prototype.raycast;
      const baseline: T.Intersection[] = [];
      standard.call(mesh, new T.Raycaster(ray().origin, ray().direction), baseline);
      const hit = query.nearest(ray());
      expect(hit).not.toBeNull(); expect(mesh.geometry).toHaveProperty("boundsTree");
      expect(hit!.distance).toBeCloseTo(baseline[0]!.distance);
      near(hit!.pointWorld, baseline[0]!.point);
      expect(hit!.faceIndex).toBe(0);
      expect(hit!.uv?.toArray()).toEqual(uv ? [0.5, 0.5] : undefined);
      expect(query.nearest(ray(8))).toBeNull();
      query.dispose();
      expect(mesh.geometry).not.toHaveProperty("boundsTree");
    }
  });
  it("returns nearest visible surface and distinct world, node and mesh coordinates", () => {
    const query = new SurfaceQuery();
    const { scene, wrapper, mesh } = mount(query, triangle());
    wrapper.position.set(2, 3, 1); wrapper.rotation.z = Math.PI / 2; wrapper.scale.set(2, 1, 3);
    mesh.position.set(0, 0, 2); mesh.scale.set(1, 2, 1);
    scene.updateMatrixWorld(true);
    const target = new T.Vector3(0, 0, 0).applyMatrix4(mesh.matrixWorld);
    const hit = query.nearest(ray(target.x, target.y));
    expect(hit).not.toBeNull(); near(hit!.pointWorld, target); near(hit!.pointLocal, new T.Vector3());
    near(hit!.pointNodeLocal, new T.Vector3(0, 0, 2));
    near(hit!.normalWorld, new T.Vector3(0, 0, 1));
    const front = new T.Mesh(triangle(), new T.MeshBasicMaterial({ side: T.DoubleSide }));
    front.position.set(0, 0, 3); wrapper.add(front); scene.updateMatrixWorld(true);
    query.register("node", wrapper, front);
    expect(query.nearest(ray(target.x, target.y))?.mesh).toBe(front);
    front.visible = false;
    expect(query.nearest(ray(target.x, target.y))?.mesh).toBe(mesh);
    wrapper.visible = false;
    expect(query.nearest(ray(target.x, target.y))).toBeNull();
    query.dispose();
  });
  it("handles normal matrix under nonuniform scale and rejects invalid data", () => {
    const query = new SurfaceQuery(); const { scene, wrapper, mesh } = mount(query, triangle());
    mesh.rotation.x = Math.PI / 4; wrapper.scale.set(2, 3, 1); scene.updateMatrixWorld(true);
    const hit = query.nearest(ray());
    expect(hit).not.toBeNull();
    const expected = new T.Vector3(0, 0, 1).applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
    near(hit!.normalWorld, expected);
    wrapper.scale.x = 0;
    expect(query.nearest(ray())).toBeNull();
    query.dispose();
    const bad = triangle(); bad.getAttribute("position").setX(0, Infinity);
    const invalid = new SurfaceQuery(); mount(invalid, bad);
    expect(invalid.nearest(ray())).toBeNull(); invalid.dispose();
  });
  it("builds BVH for all six primitive geometries", () => {
    for (const primitive of ["cube", "sphere", "torus", "cylinder", "cone", "plane"] as const) {
      const query = new SurfaceQuery();
      const source = { kind: "primitive" as const, primitive, parameters: {} };
      const { mesh } = mount(query, primitiveGeometry(source));
      expect(mesh.geometry).toHaveProperty("boundsTree");
      expect(query.nearest(ray())?.nodeId ?? "node").toBe("node");
      query.dispose();
    }
  });
  it("queries a nested static GLB mesh without changing document history or dirty state", async () => {
    const project = createNestedMeshProject();
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    if (node.kind !== "mesh") throw new Error("fixture");
    node.meshSource = { kind: "asset", assetId: "glb" };
    project.assets.push({ id: "glb", hash: "a".repeat(64), mediaType: "model/gltf-binary", path: "assets/glb.glb", colorSpace: "none" });
    const store = createEditorStore(project);
    const root = new T.Group(); const nested = new T.Group(); nested.position.z = 2;
    const mesh = new T.Mesh(triangle(), new T.MeshBasicMaterial({ side: T.DoubleSide }));
    nested.add(mesh); root.add(nested);
    const graph = new SceneSync(() => {}, async () => root);
    graph.sync(store.getSnapshot().document.project, () => new Uint8Array([1]), store.getProjectEpoch());
    await Promise.resolve(); await Promise.resolve();
    const before = store.getSnapshot();
    const hit = graph.surfaces.nearest(ray());
    expect(hit?.nodeId).toBe("mesh-node"); expect(hit?.mesh).toBe(mesh);
    near(hit!.pointLocal, new T.Vector3()); near(hit!.pointNodeLocal, new T.Vector3(0, 0, 2));
    expect(store.getSnapshot().document.revision).toBe(before.document.revision);
    expect(store.getSnapshot().history.entries).toEqual(before.history.entries);
    expect(store.getSnapshot().document.dirty).toBe(before.document.dirty);
    graph.dispose();
  });
  it("uses an asynchronous worker copy and ignores late results after replacement", async () => {
    let resolve!: (bvh: MeshBVH) => void;
    let copied!: T.BufferGeometry;
    const dispose = vi.fn();
    const query = new SurfaceQuery(1, () => ({ dispose, generate: copy => {
      copied = copy; return new Promise<MeshBVH>(done => { resolve = done; });
    } }));
    vi.stubGlobal("Worker", class {});
    const original = triangle(); const { mesh } = mount(query, original);
    await vi.waitFor(() => expect(copied).toBeDefined());
    expect(copied).not.toBe(original);
    expect(copied.getAttribute("position").array.buffer).not.toBe(original.getAttribute("position").array.buffer);
    expect(query.nearest(ray())?.mesh).toBe(mesh); // standard raycast while pending
    query.release(mesh);
    resolve(new MeshBVH(copied, { indirect: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(original).not.toHaveProperty("boundsTree");
    expect(dispose).toHaveBeenCalled();
    query.dispose(); vi.unstubAllGlobals();
  });
  it("attaches a completed worker BVH to the live indexed and non-indexed geometry", async () => {
    vi.stubGlobal("Worker", class {});
    for (const indexed of [true, false]) {
      let resolve!: (bvh: MeshBVH) => void;
      let copy!: T.BufferGeometry;
      const query = new SurfaceQuery(1, () => ({ dispose: vi.fn(), generate: geometry => {
        copy = geometry; return new Promise(done => { resolve = done; });
      } }));
      const geometry = triangle(indexed); const { mesh } = mount(query, geometry);
      await vi.waitFor(() => expect(copy).toBeDefined());
      expect(geometry.getAttribute("position").array.byteLength).toBeGreaterThan(0);
      resolve(new MeshBVH(copy, { indirect: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(geometry).toHaveProperty("boundsTree");
      expect(mesh.raycast).toBe(acceleratedRaycast);
      expect(query.nearest(ray())?.faceIndex).toBe(0);
      query.dispose();
    }
    vi.unstubAllGlobals();
  });
  it("keeps fallback raycast after worker failure without automatic retry", async () => {
    const generate = vi.fn(() => Promise.reject(new Error("worker failed")));
    const query = new SurfaceQuery(1, () => ({ generate, dispose: vi.fn() }));
    vi.stubGlobal("Worker", class {});
    const { mesh } = mount(query, triangle());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(query.nearest(ray())?.mesh).toBe(mesh);
    expect(generate).toHaveBeenCalledOnce();
    query.dispose(); vi.unstubAllGlobals();
  });
  it("serializes heavy builds through one reusable Worker", async () => {
    vi.stubGlobal("Worker", class {});
    const pending: Array<{ copy: T.BufferGeometry; done: (bvh: MeshBVH) => void }> = [];
    const generate = vi.fn((copy: T.BufferGeometry) => new Promise<MeshBVH>(done => pending.push({ copy, done })));
    const makeWorker = vi.fn(() => ({ generate, dispose: vi.fn() }));
    const query = new SurfaceQuery(1, makeWorker);
    const second = triangle();
    mount(query, triangle(), "one"); mount(query, second, "two");
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(generate).toHaveBeenCalledTimes(1);
    pending[0]!.done(new MeshBVH(pending[0]!.copy, { indirect: true }));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(makeWorker).toHaveBeenCalledOnce();
    pending[1]!.done(new MeshBVH(pending[1]!.copy, { indirect: true }));
    await vi.waitFor(() => expect(second).toHaveProperty("boundsTree"));
    query.dispose(); vi.unstubAllGlobals();
  });
  it("invalidates old geometry on primitive edit and keeps BVH on transform/material changes", () => {
    const project = createNestedMeshProject(); const graph = new SceneSync(() => {});
    graph.sync(project, () => undefined);
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    if (node.kind !== "mesh" || node.meshSource.kind !== "primitive") throw new Error("fixture");
    const first = (graph.objects.get(node.id)!.content as T.Mesh).geometry;
    const firstBvh = (first as T.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree;
    node.transform.position = [2, 0, 0]; graph.sync(project, () => undefined);
    expect((graph.objects.get(node.id)!.content as T.Mesh).geometry).toBe(first);
    project.materials.push({ id: "material", name: "Тест", baseColor: [1, 0, 0], metalness: 0, roughness: .5,
      emissive: [0, 0, 0], opacity: 1, transmission: 0, ior: 1.5, clearcoat: 0, envIntensity: 1, textureAssetIds: [] });
    node.materialSlots.push({ name: "Основной", materialId: "material" });
    graph.sync(project, () => undefined);
    expect((graph.objects.get(node.id)!.content as T.Mesh).geometry).toBe(first);
    expect((first as T.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree).toBe(firstBvh);
    node.meshSource.parameters.size = 2; graph.sync(project, () => undefined);
    const second = (graph.objects.get(node.id)!.content as T.Mesh).geometry;
    expect(second).not.toBe(first); expect(first).not.toHaveProperty("boundsTree");
    node.meshSource.parameters.size = 1; graph.sync(project, () => undefined);
    expect(second).not.toHaveProperty("boundsTree");
    graph.dispose();
  });
});
