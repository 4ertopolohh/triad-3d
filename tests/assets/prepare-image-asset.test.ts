import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createProject } from "../../src/domain";
import { createEditorStore } from "../../src/app/editor-store";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { browserImageDecoder, imageDimensions, prepareImageAsset, withinImageBudget, type ImageFormat } from "../../src/assets/prepare-image-asset";

const fromDisk = async (format: string) => new Uint8Array(await readFile(new URL(`./sample.${format}`, import.meta.url)));
const file = (bytes: Uint8Array, format: string, type = "") => new File([bytes as BlobPart], `sample.${format}`, { type });
const rasterDecode = async (bytes: Uint8Array, format: ImageFormat) => {
  const size = imageDimensions(bytes, format);
  if (!size) throw new Error("invalid");
  return { width: size[0], height: size[1] };
};

describe("image asset ingestion", () => {
  it.each(["png", "jpg", "webp", "exr"])("prepares %s and keeps original bytes", async format => {
    const bytes = await fromDisk(format);
    const result = await prepareImageAsset(file(bytes, format), format === "exr" ? browserImageDecoder : rasterDecode);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bytes).toEqual(bytes);
      expect(result.value.asset.path).toBe(`assets/${result.value.asset.hash}.${format}`);
      expect([result.value.width, result.value.height]).toEqual([2, 2]);
    }
  });
  it("decodes the repository Radiance HDR with Three.js", async () => {
    const bytes = new Uint8Array(await readFile(new URL("../../src/spikes/renderer/assets/studio_small_03_1k.hdr", import.meta.url)));
    const result = await prepareImageAsset(file(bytes, "hdr"), browserImageDecoder);
    expect(result.ok).toBe(true);
  });
  it("rejects MIME mismatch, bad payload, oversized file, dimension bomb and unsupported EXR", async () => {
    const bytes = await fromDisk("png");
    expect((await prepareImageAsset(file(bytes, "png", "image/jpeg"), rasterDecode)).ok).toBe(false);
    expect((await prepareImageAsset(file(bytes, "jpg", "image/jpeg"), rasterDecode)).ok).toBe(false);
    expect((await prepareImageAsset(file(bytes.subarray(0, 25), "png"), rasterDecode)).ok).toBe(false);
    expect((await prepareImageAsset(file(new Uint8Array(0), "png"), rasterDecode)).ok).toBe(false);
    const oversized = { name: "huge.png", type: "image/png", size: 64 * 1024 * 1024 + 1, arrayBuffer: () => { throw new Error("must not read"); } } as unknown as File;
    expect((await prepareImageAsset(oversized, rasterDecode)).ok).toBe(false);
    expect(withinImageBudget(16384, 16384)).toBe(false);
    const bomb = bytes.slice();
    bomb.set([0, 0, 64, 0], 16); bomb.set([0, 0, 64, 0], 20);
    expect((await prepareImageAsset(file(bomb, "png"), rasterDecode)).ok).toBe(false);
    const exr = await fromDisk("exr");
    const marker = new TextEncoder().encode("compression\0compression\0");
    const position = exr.findIndex((_, i) => marker.every((n, j) => exr[i + j] === n));
    expect(position).toBeGreaterThan(0);
    const unsupported = exr.slice();
    unsupported[position + marker.length + 4] = 255;
    expect((await prepareImageAsset(file(unsupported, "exr"), browserImageDecoder)).ok).toBe(false);
    expect((await prepareImageAsset(file(exr.subarray(0, 20), "exr"), browserImageDecoder)).ok).toBe(false);
    expect((await prepareImageAsset(file(new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n"), "hdr"), browserImageDecoder)).ok).toBe(false);
  });
  it("commits once, supports undo/redo, save/open and rejects stale revision", async () => {
    const bytes = await fromDisk("png");
    const prepared = await prepareImageAsset(file(bytes, "png"), rasterDecode);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const store = createEditorStore(createProject());
    const captured = store.captureDocument();
    const command = { commandId: "import-1", type: "ADD_ASSET" as const, targetIds: [prepared.value.asset.id] as [string], payload: { asset: prepared.value.asset } };
    expect((await store.addAsset(command, bytes, captured.revision, captured.identity)).ok).toBe(true);
    const after = store.captureDocument();
    expect(after.project.assets).toHaveLength(1);
    expect(await store.addAsset(command, bytes, after.revision, after.identity)).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(1);
    expect(await store.addAsset(command, bytes, captured.revision, captured.identity)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(store.undo(after.revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.assets).toHaveLength(0);
    expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.readAssetBytes(prepared.value.asset.id)).toEqual(bytes);
    const snapshot = store.captureDocument();
    const archive = await createNativeProjectArchive(snapshot.project, snapshot.assets, "0.1.0");
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    const opened = await openNativeProjectArchive(archive.value);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.assets.get(prepared.value.asset.id)).toEqual(bytes);
    const old = store.captureDocument();
    expect(store.replaceProject({ project: createProject(), assets: opened.ok ? opened.value.assets : snapshot.assets }, old.identity)).toBe(true);
    expect(await store.addAsset(command, bytes, old.revision, old.identity)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
  });
  it("does not publish failed imports and prunes bytes from abandoned redo history", async () => {
    const bytes = await fromDisk("png");
    const prepared = await prepareImageAsset(file(bytes, "png"), rasterDecode);
    if (!prepared.ok) throw new Error("fixture invalid");
    const store = createEditorStore(createProject());
    const first = store.captureDocument();
    const command = { commandId: "add-image", type: "ADD_ASSET" as const, targetIds: [prepared.value.asset.id] as [string], payload: { asset: prepared.value.asset } };
    const invalid = bytes.slice(); invalid[invalid.length - 1] = (invalid.at(-1) ?? 0) ^ 1;
    expect(await store.addAsset(command, invalid, first.revision, first.identity)).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(store.getSnapshot().document).toMatchObject({ dirty: false, revision: 0 });
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect((await store.addAsset(command, bytes, first.revision, first.identity)).ok).toBe(true);
    expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);
    expect(store.readAssetBytes(prepared.value.asset.id)).toEqual(bytes);
    const second = await prepareImageAsset(file(await fromDisk("jpg"), "jpg"), rasterDecode);
    if (!second.ok) throw new Error("fixture invalid");
    const current = store.captureDocument();
    expect((await store.addAsset({ commandId: "add-jpg", type: "ADD_ASSET", targetIds: [second.value.asset.id], payload: { asset: second.value.asset } }, second.value.bytes, current.revision, current.identity)).ok).toBe(true);
    expect(store.readAssetBytes(prepared.value.asset.id)).toBeUndefined();
  });
  it("rejects a prepared import after project replacement", async () => {
    const store = createEditorStore(createProject());
    const old = store.captureDocument();
    const prepared = await prepareImageAsset(file(await fromDisk("webp"), "webp"), rasterDecode);
    if (!prepared.ok) throw new Error("fixture invalid");
    expect(store.replaceProject({ project: createProject(), assets: old.assets }, old.identity)).toBe(true);
    const result = await store.addAsset({ commandId: "late", type: "ADD_ASSET", targetIds: [prepared.value.asset.id], payload: { asset: prepared.value.asset } }, prepared.value.bytes, old.revision, old.identity);
    expect(result).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(store.getSnapshot().document).toMatchObject({ dirty: false, revision: 0 });
    expect(store.getSnapshot().history.entries).toHaveLength(0);
  });
  it("honors cancellation after decoding without a prepared resource", async () => {
    const controller = new AbortController();
    const result = await prepareImageAsset(file(await fromDisk("png"), "png"), async (bytes, format) => {
      controller.abort();
      return rasterDecode(bytes, format);
    }, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });
});
