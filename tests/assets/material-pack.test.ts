import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createProject } from "../../src/domain/create-project";
import { createEditorStore } from "../../src/app/editor-store";
import { materialPresets } from "../../src/materials/presets";
import { createMaterialPack, openMaterialPack, prepareMaterialPack } from "../../src/assets/material-pack";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { imageDimensions, type ImageFormat } from "../../src/assets/prepare-image-asset";

const decodeFixture = async (bytes: Uint8Array, format: ImageFormat) => {
  const size = imageDimensions(bytes, format);
  if (!size) throw new Error("Invalid fixture");
  return { width: size[0], height: size[1] };
};

it("rejects image dimension bombs before decoding and rejects decoder failures", async () => {
  const original = new Uint8Array(await readFile(new URL("./sample.png", import.meta.url)));
  const bomb = original.slice(); bomb.set([0, 0, 64, 0], 16); bomb.set([0, 0, 64, 0], 20);
  for (const bytes of [bomb, original]) {
    const hash = createHash("sha256").update(bytes).digest("hex"), project = createProject();
    project.assets.push({ id: "image", hash, path: `assets/${hash}.png`, mediaType: "image/png", colorSpace: "srgb" });
    const archive = await createMaterialPack(project, () => bytes);
    const decoder = vi.fn(async () => { throw new Error("damaged"); });
    await expect(openMaterialPack(archive, decoder)).rejects.toThrow(bytes === bomb ? "лимит" : "декодировать");
    expect(decoder).toHaveBeenCalledTimes(bytes === bomb ? 0 : 1);
  }
});

it("normalizes JPEG paths before command ingestion and honours cancellation", async () => {
  const bytes = new Uint8Array(await readFile(new URL("./sample.jpg", import.meta.url)));
  const hash = createHash("sha256").update(bytes).digest("hex"), project = createProject();
  project.assets.push({ id: "image", hash, path: `assets/${hash}.jpeg`, mediaType: "image/jpeg", colorSpace: "srgb" });
  project.assets.push({ id: "same-image", hash, path: `assets/${hash}.jpg`, mediaType: "image/jpeg", colorSpace: "srgb" });
  const pack = await openMaterialPack(await createMaterialPack(project, () => bytes), decodeFixture);
  expect(pack.project.assets[0]!.path).toBe(`assets/${hash}.jpg`);
  const store = createEditorStore(createProject()), capture = store.captureDocument(), prepared = prepareMaterialPack(pack, capture.project);
  expect(prepared.commands.filter(command => command.type === "ADD_ASSET")).toHaveLength(1);
  const controller = new AbortController(); controller.abort();
  expect((await store.addLibraryPack(prepared.commands, prepared.bytes, capture.revision, capture.identity, controller.signal)).ok).toBe(false);
  expect(store.captureDocument().project).toEqual(capture.project);
  expect((await store.addLibraryPack(prepared.commands, prepared.bytes, capture.revision, capture.identity)).ok).toBe(true);
});

it("roundtrips licensed material resources, deduplicates bytes and imports with whole-pack undo/redo",async()=>{
  const bytes=new Uint8Array(await readFile(new URL("./sample.png",import.meta.url))),hash=createHash("sha256").update(bytes).digest("hex"),source=createProject();
  source.assets.push({id:"image",hash,path:`assets/${hash}.png`,mediaType:"image/png",colorSpace:"srgb"});
  source.materials.push({...structuredClone(materialPresets[0]!.material),id:"material",textureSlots:{baseColor:"image"},textureAssetIds:["image"]});
  const pack=await openMaterialPack(await createMaterialPack(source,()=>bytes,"CC0 — fixture"),decodeFixture);
  expect(pack.project.assets[0]!.license).toBe("CC0 — fixture");expect(source.assets[0]!.license).toBeUndefined();
  const store=createEditorStore(createProject()),capture=store.captureDocument(),prepared=prepareMaterialPack(pack,capture.project);
  expect((await store.addLibraryPack(prepared.commands,prepared.bytes,capture.revision,capture.identity)).ok).toBe(true);
  const imported=store.captureDocument();expect(imported.project.materials).toHaveLength(1);expect(imported.project.assets).toHaveLength(1);
  const assetId=imported.project.assets[0]!.id;expect(imported.project.materials[0]!.textureSlots?.baseColor).toBe(assetId);
  expect(store.undo(imported.revision).ok).toBe(true);expect(store.getSnapshot().document.project.assets).toHaveLength(0);
  expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);expect(store.readAssetBytes(assetId)).toEqual(bytes);
  const duplicate=prepareMaterialPack(pack,store.captureDocument().project);expect(duplicate.bytes.size).toBe(0);expect(duplicate.commands).toHaveLength(1);
  const saved=await createNativeProjectArchive(store.captureDocument().project,store.getAssetBytes(),"0.1.0");if(!saved.ok)throw new Error(saved.error.message);
  const reopened=await openNativeProjectArchive(saved.value);expect(reopened.ok).toBe(true);if(reopened.ok)expect(reopened.value.project.assets[0]!.license).toBe("CC0 — fixture");
});

it("rejects non-library geometry and corrupted bytes without partial material writes",async()=>{
  const project=createProject(),node=createPrimitiveNode("cube",project.model.rootNodeId,"mesh");project.nodes.push(node);project.nodes[0]!.children.push(node.id);
  const archive=await createNativeProjectArchive(project,new AssetBytes(),"0.1.0");if(!archive.ok)throw new Error("archive");await expect(openMaterialPack(archive.value)).rejects.toThrow("не библиотечный");
  const store=createEditorStore(createProject()),capture=store.captureDocument();
  const result=await store.addLibraryPack([{commandId:"add",type:"ADD_ASSET",targetIds:["bad"],payload:{asset:{id:"bad",hash:"0".repeat(64),path:`assets/${"0".repeat(64)}.png`,mediaType:"image/png",colorSpace:"srgb"}}}],new Map([["bad",new Uint8Array([1,2,3])]]),capture.revision,capture.identity);
  expect(result.ok).toBe(false);expect(store.captureDocument().project).toEqual(capture.project);expect(store.getSnapshot().history.canUndo).toBe(false);
});
