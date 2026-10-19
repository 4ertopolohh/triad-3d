import { describe, expect, it, vi } from "vitest";
import { createProject } from "../../src/domain/create-project";
import { createEditorStore } from "../../src/app/editor-store";
import { prepareGlb, commitGlb } from "../../src/importers/gltf/import-glb";
import { applyProjectPatch } from "../../src/domain/command-bus";
import { createNativeProjectArchive, openNativeProjectArchive, ARCHIVE_LIMITS } from "../../src/assets/native-project-archive";

function fixture(change: (json: Record<string, unknown>) => void = () => {}): Uint8Array {
  const json: Record<string, unknown> = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  };
  change(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(encoded, 20);
  const binAt = 20 + jsonLength;
  view.setUint32(binAt, 36, true); view.setUint32(binAt + 4, 0x004e4942, true);
  for (const [index, value] of [0, 0, 0, 1, 0, 0, 0, 1, 0].entries()) view.setFloat32(binAt + 8 + index * 4, value, true);
  return bytes;
}
function file(bytes: Uint8Array, name = "triangle.glb") { return new File([bytes as BlobPart], name, { type: "model/gltf-binary" }); }

describe("GLB import", () => {
  it("validates geometry, commits atomically, replays patches and preserves bytes through archive", async () => {
    const bytes = fixture();
    const prepared = await prepareGlb(file(bytes));
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.error));
    if (!prepared.ok) return;
    expect(prepared.value.triangles).toBe(1);
    const store = createEditorStore(createProject());
    const before = store.captureDocument();
    let publications = 0;
    store.subscribe(() => { publications += 1; expect(store.getSnapshot().document.project.assets.length).toBe(1); expect(store.getAssetBytes().ids()).toHaveLength(1); });
    const result = commitGlb(store, prepared.value, before.revision, before.identity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(publications).toBe(1);
    expect(store.getSnapshot().document.dirty).toBe(true);
    expect(store.getSnapshot().document.project.nodes).toHaveLength(2);
    expect(applyProjectPatch(before.project, result.patch)).toEqual(result.project);
    expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(before.project);
    const archived = await createNativeProjectArchive(store.captureDocument().project, store.getAssetBytes(), "0.1.0");
    if (!archived.ok) throw new Error(JSON.stringify(archived.error));
    if (!archived.ok) return;
    const opened = await openNativeProjectArchive(archived.value);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const asset = opened.value.project.assets[0];
    if (!asset) throw new Error("Missing imported asset");
    expect(opened.value.assets.get(asset.id)).toEqual(bytes);
    expect(opened.value.project.nodes[1]).toMatchObject({ parentId: opened.value.project.model.rootNodeId, meshSource: { assetId: asset.id } });
  });

  it("rejects corrupt or unsupported inputs before parsing and makes no network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cases = [
      (() => { const value = fixture(); value[0] = 0; return value; })(),
      (() => { const value = fixture(); new DataView(value.buffer).setUint32(4, 1, true); return value; })(),
      (() => { const value = fixture(); new DataView(value.buffer).setUint32(8, 1, true); return value; })(),
      (() => { const value = fixture(); value[20] = 0; return value; })(),
      fixture((json) => { json.buffers = [{ byteLength: 36, uri: "https://example.com/model.bin" }]; }),
      fixture((json) => { json.images = [{ uri: "../../secret.png" }]; }),
      fixture((json) => { json.extensionsRequired = ["KHR_draco_mesh_compression"]; }),
      fixture((json) => { json.animations = [{}]; }),
      fixture((json) => { json.meshes = []; }),
    ];
    try {
      for (const bytes of cases) expect((await prepareGlb(file(bytes))).ok).toBe(false);
      expect((await prepareGlb(file(new Uint8Array(ARCHIVE_LIMITS.asset + 1)))).ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("rejects a stale preparation without changing project, bytes or history", async () => {
    const prepared = await prepareGlb(file(fixture()));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const store = createEditorStore(createProject());
    const captured = store.captureDocument();
    store.replaceProject({ project: createProject(), assets: store.getAssetBytes() }, captured.identity);
    const before = store.getSnapshot();
    expect(commitGlb(store, prepared.value, captured.revision, captured.identity).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(store.getAssetBytes().ids()).toHaveLength(0);
  });

  it("reuses identical bytes and rejects revision conflicts", async () => {
    const prepared = await prepareGlb(file(fixture()));
    if (!prepared.ok) throw new Error("fixture did not parse");
    const store = createEditorStore(createProject());
    const firstCapture = store.captureDocument();
    expect(commitGlb(store, prepared.value, firstCapture.revision, firstCapture.identity).ok).toBe(true);
    const afterFirst = store.captureDocument();
    expect(commitGlb(store, prepared.value, firstCapture.revision, firstCapture.identity).ok).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(commitGlb(store, prepared.value, afterFirst.revision, afterFirst.identity).ok).toBe(true);
    expect(store.getSnapshot().document.project.assets).toHaveLength(1);
    expect(store.getAssetBytes().ids()).toHaveLength(1);
    expect(store.getSnapshot().document.project.nodes).toHaveLength(3);
  });

  it("rolls back asset bytes and history on an entity ID conflict", async () => {
    const prepared = await prepareGlb(file(fixture()));
    if (!prepared.ok) throw new Error("fixture did not parse");
    const store = createEditorStore(createProject());
    const captured = store.captureDocument();
    const rootId = captured.project.model.rootNodeId;
    const assetId = crypto.randomUUID();
    const command = {
      commandId: crypto.randomUUID(), type: "ADD_MESH_ASSET" as const,
      targetIds: [rootId, rootId, assetId] as [string, string, string],
      payload: { parentId: rootId, node: {
        id: rootId, kind: "mesh" as const, name: "bad", parentId: rootId, children: [],
        transform: { position: [0, 0, 0] as const, rotationQuat: [0, 0, 0, 1] as const, scale: [1, 1, 1] as const },
        visible: true, locked: false, materialSlots: [], modifierIds: [], meshSource: { kind: "asset" as const, assetId },
      }, asset: { id: assetId, hash: prepared.value.hash, path: `assets/${prepared.value.hash}.glb`, mediaType: "model/gltf-binary", colorSpace: "none" as const } },
    };
    expect(store.addMeshAsset(command, prepared.value.bytes, captured.revision, captured.identity).ok).toBe(false);
    expect(store.getSnapshot().document.project).toEqual(captured.project);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.getAssetBytes().ids()).toHaveLength(0);
  });
});
