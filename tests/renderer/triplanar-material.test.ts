import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { SceneSync, type SceneStatus } from "../../src/renderer/scene-sync";
import { triplanarWeights } from "../../src/renderer/triplanar-material";

describe("Triplanar base color", () => {
  it("normalizes deterministic fourth-power axis weights", () => {
    expect(triplanarWeights([1, 0, 0])).toEqual([1, 0, 0]);
    expect(triplanarWeights([0, -1, 0])).toEqual([0, 1, 0]);
    expect(triplanarWeights([0, 0, 1])).toEqual([0, 0, 1]);
    expect(triplanarWeights([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(triplanarWeights([1, 2, 1])).toEqual([1 / 18, 16 / 18, 1 / 18]);
  });

  it("binds after decode on a UV-less mesh and releases on mode change", async () => {
    const project = createMaterialAnimationProject();
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    if (node.kind !== "mesh") throw new Error("fixture");
    node.meshSource = { kind: "editable", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    project.assets.push({ id: "image", hash: "a".repeat(64), mediaType: "image/png", path: "assets/image.png", colorSpace: "srgb" });
    project.materials[0]!.textureSlots = { baseColor: "image" };
    project.materials[0]!.textureMappings = { baseColor: { mode: "triplanar", tiling: [2, 3], offset: [4, 5] } };
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close } as unknown as ImageBitmap));
    try {
      let status: SceneStatus | undefined;
      const sync = new SceneSync(value => { status = value; });
      sync.sync(project, () => new Uint8Array([1]));
      const content = sync.objects.get(node.id)!.content as T.Mesh;
      const geometry = content.geometry;
      expect(geometry.getAttribute("uv")).toBeUndefined();
      expect(content.material).toBeInstanceOf(MeshPhysicalNodeMaterial);
      await Promise.resolve(); await Promise.resolve();
      expect((content.material as MeshPhysicalNodeMaterial).colorNode).not.toBeNull();
      expect(status?.diagnostics.some(message => message.includes("нет UV"))).toBe(false);
      project.materials[0]!.textureMappings.baseColor = { mode: "uv" };
      sync.sync(project, () => new Uint8Array([1]));
      expect(content.geometry).toBe(geometry);
      expect(content.geometry.getAttribute("uv")).toBeUndefined();
      expect(close).toHaveBeenCalledOnce();
      sync.dispose();
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps a UV-less derived mesh and drops a late decode after deletion", async () => {
    const project = createMaterialAnimationProject();
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    project.assets.push({ id: "image", hash: "b".repeat(64), mediaType: "image/png", path: "assets/image.png", colorSpace: "srgb" });
    project.materials[0]!.textureSlots = { baseColor: "image" };
    project.materials[0]!.textureMappings = { baseColor: { mode: "triplanar", tiling: [1, 1], offset: [0, 0] } };
    let resolve!: (bitmap: ImageBitmap) => void;
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise<ImageBitmap>(done => { resolve = done; })));
    try {
      const sync = new SceneSync(() => {});
      sync.sync(project, () => new Uint8Array([1]));
      const content = sync.objects.get(node.id)!.content as T.Mesh;
      const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]) };
      sync.setDerived(node.id, mesh, false);
      const derived = sync.objects.get(node.id)!.content as T.Mesh;
      expect(derived).not.toBe(content);
      expect(derived.geometry.getAttribute("uv")).toBeUndefined();
      expect(derived.material).toBeInstanceOf(MeshPhysicalNodeMaterial);
      project.nodes = project.nodes.filter(item => item.id !== node.id);
      const parent = project.nodes.find(item => item.id === "nested-group")!;
      parent.children = parent.children.filter(id => id !== node.id);
      sync.sync(project, () => new Uint8Array([1]));
      resolve({ close } as unknown as ImageBitmap);
      await Promise.resolve(); await Promise.resolve();
      expect(close).toHaveBeenCalledOnce();
      sync.dispose();
    } finally { vi.unstubAllGlobals(); }
  });
});
