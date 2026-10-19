import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { deserializeProjectDocument, serializeProjectDocument, validateNativeManifest, NATIVE_FORMAT_VERSION } from "../domain/project-serialization";
import type { NativeManifest } from "../domain/project-serialization";
import type { Project } from "../domain/types";
import { AssetBytes } from "./asset-bytes";

const MiB = 1024 * 1024;
export const ARCHIVE_LIMITS = Object.freeze({ archive: 128 * MiB, expanded: 256 * MiB, entries: 1024, asset: 64 * MiB, document: 16 * MiB, manifest: MiB });
export type ArchiveError = { code: "FILE_INVALID" | "SCHEMA_UNSUPPORTED" | "ASSET_MISSING" | "ASSET_INTEGRITY"; message: string; path?: string };
export type ArchiveResult<T> = { ok: true; value: T } | { ok: false; error: ArchiveError };
export interface LoadedProject { project: Project; assets: AssetBytes }
const fail = (code: ArchiveError["code"], message: string, path?: string): ArchiveResult<never> => ({ ok: false, error: { code, message, ...(path ? { path } : {}) } });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const folded = (path: string) => path.normalize("NFC").toLocaleLowerCase("en-US");
const assetPathPattern = /^assets\/[a-f0-9]{64}\.(?:png|jpe?g|webp|hdr|exr|glb|bin)$/;
const sha = async (bytes: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((n) => n.toString(16).padStart(2, "0")).join("");
const forbiddenPayload = (bytes: Uint8Array) =>
  (bytes[0] === 0x50 && bytes[1] === 0x4b) || // nested ZIP
  (bytes[0] === 0x4d && bytes[1] === 0x5a) || // Windows executable
  (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46); // ELF executable

function safePath(path: string): boolean {
  return path.length > 0 && path.length <= 1024 && path === path.normalize("NFC") && !/[\\:%]/.test(path)
    && !path.startsWith("/") && !path.endsWith("/") && !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function checkAssets(project: Project, manifest: NativeManifest): ArchiveResult<true> {
  if (project.assets.length !== manifest.assets.length) return fail("ASSET_INTEGRITY", "Список ресурсов документа и архива различается.");
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const asset of project.assets) {
    const record = byId.get(asset.id);
    if (!record) return fail("ASSET_MISSING", `Ресурс «${asset.id}» отсутствует в manifest.`);
    if (record.path !== asset.path || record.sha256.toLowerCase() !== asset.hash.toLowerCase()) return fail("ASSET_INTEGRITY", `Метаданные ресурса «${asset.id}» не совпадают.`, asset.path);
    if (!safePath(asset.path) || !assetPathPattern.test(asset.path)) return fail("FILE_INVALID", "Недопустимый путь ресурса.", asset.path);
    if (asset.path.slice(7, 71) !== asset.hash.toLowerCase()) return fail("ASSET_INTEGRITY", "Имя ресурса не соответствует хешу.", asset.path);
  }
  return { ok: true, value: true };
}

async function buildNativeProjectArchive(project: Project, assets: AssetBytes, appVersion: string): Promise<ArchiveResult<Blob>> {
  const serialized = serializeProjectDocument(project);
  if (!serialized.ok) return { ok: false, error: serialized.error };
  const documentBytes = encoder.encode(serialized.value);
  if (documentBytes.byteLength > ARCHIVE_LIMITS.document) return fail("FILE_INVALID", "Документ слишком велик.");
  const records: NativeManifest["assets"] = [];
  const contents = new Map<string, Uint8Array>();
  let total = documentBytes.byteLength;
  for (const asset of project.assets) {
    const bytes = assets.get(asset.id);
    if (!bytes) return fail("ASSET_MISSING", `Ресурс «${asset.id}» отсутствует в памяти.`, asset.path);
    if (bytes.byteLength > ARCHIVE_LIMITS.asset) return fail("FILE_INVALID", "Ресурс слишком велик.", asset.path);
    if (forbiddenPayload(bytes)) return fail("FILE_INVALID", "Вложенный архив или исполняемый ресурс запрещён.", asset.path);
    const hash = await sha(bytes);
    if (hash !== asset.hash.toLowerCase()) return fail("ASSET_INTEGRITY", `Хеш ресурса «${asset.id}» не совпадает.`, asset.path);
    records.push({ id: asset.id, path: asset.path, sha256: hash });
    contents.set(asset.path, bytes);
    total += bytes.byteLength;
    if (total > ARCHIVE_LIMITS.expanded) return fail("FILE_INVALID", "Превышен общий размер проекта.");
  }
  const manifest: NativeManifest = { formatVersion: NATIVE_FORMAT_VERSION, appVersion, document: { path: "document.json", sha256: await sha(documentBytes) }, assets: records };
  const checked = validateNativeManifest(manifest);
  if (!checked.ok) return { ok: false, error: checked.error };
  const consistency = checkAssets(project, manifest);
  if (!consistency.ok) return consistency;
  const manifestText = JSON.stringify(manifest);
  total += encoder.encode(manifestText).byteLength;
  if (encoder.encode(manifestText).byteLength > ARCHIVE_LIMITS.manifest || total > ARCHIVE_LIMITS.expanded || contents.size + 2 > ARCHIVE_LIMITS.entries) return fail("FILE_INVALID", "Превышен лимит архива.");
  try {
    const writer = new ZipWriter(new BlobWriter("application/x-triad3d"));
    await writer.add("manifest.json", new TextReader(manifestText));
    await writer.add("document.json", new Uint8ArrayReader(documentBytes));
    for (const [path, bytes] of contents) await writer.add(path, new Uint8ArrayReader(bytes));
    const blob = await writer.close();
    if (blob.size > ARCHIVE_LIMITS.archive) return fail("FILE_INVALID", "Архив слишком велик.");
    return { ok: true, value: blob };
  } catch { return fail("FILE_INVALID", "Не удалось создать архив проекта."); }
}

export async function createNativeProjectArchive(project: Project, assets: AssetBytes, appVersion: string): Promise<ArchiveResult<Blob>> {
  try { return await buildNativeProjectArchive(project, assets, appVersion); }
  catch { return fail("FILE_INVALID", "Не удалось подготовить архив проекта."); }
}

export async function openNativeProjectArchive(input: Blob | ArrayBuffer): Promise<ArchiveResult<LoadedProject>> {
  const blob = input instanceof Blob ? input : new Blob([input]);
  if (blob.size < 4 || blob.size > ARCHIVE_LIMITS.archive) return fail("FILE_INVALID", "Недопустимый размер архива.");
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) return fail("FILE_INVALID", "Файл не является ZIP-архивом проекта.");
  const reader = new ZipReader(new BlobReader(blob), { strictness: "strict", checkCrc32: true, checkOverlappingEntry: true });
  try {
    const paths = new Map<string, Awaited<ReturnType<typeof reader.getEntries>>[number]>();
    let declared = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (paths.size >= ARCHIVE_LIMITS.entries) return fail("FILE_INVALID", "Слишком много записей ZIP.");
      const path = entry.filename;
      if (entry.directory || !safePath(path) || entry.encrypted || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) return fail("FILE_INVALID", "Недопустимая запись ZIP.", path);
      const key = folded(path);
      if (paths.has(key)) return fail("FILE_INVALID", "Повторяющийся путь ZIP.", path);
      if (path !== "manifest.json" && path !== "document.json" && !assetPathPattern.test(path)) return fail("FILE_INVALID", "Неизвестная запись ZIP.", path);
      paths.set(key, entry);
      const limit = path === "manifest.json" ? ARCHIVE_LIMITS.manifest : path === "document.json" ? ARCHIVE_LIMITS.document : ARCHIVE_LIMITS.asset;
      if (entry.uncompressedSize > limit) return fail("FILE_INVALID", "Запись ZIP превышает лимит.", path);
      declared += entry.uncompressedSize;
      if (declared > ARCHIVE_LIMITS.expanded) return fail("FILE_INVALID", "Превышен общий размер распаковки.");
    }
    if (!paths.has("manifest.json") || !paths.has("document.json")) return fail("FILE_INVALID", "В архиве нет manifest.json или document.json.");
    let actualTotal = 0;
    async function read(path: string, limit: number): Promise<Uint8Array> {
      const entry = paths.get(folded(path));
      if (!entry || entry.directory) throw new Error("missing entry");
      const chunks: Uint8Array[] = [];
      let length = 0;
      await entry.getData(new WritableStream<Uint8Array>({
        write(chunk) {
          length += chunk.byteLength;
          actualTotal += chunk.byteLength;
          if (length > limit || actualTotal > ARCHIVE_LIMITS.expanded) throw new Error("expanded limit");
          chunks.push(chunk.slice());
        },
      }));
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    }
    const manifestBytes = await read("manifest.json", ARCHIVE_LIMITS.manifest);
    let manifestValue: unknown;
    try { manifestValue = JSON.parse(decoder.decode(manifestBytes)); } catch { return fail("FILE_INVALID", "Некорректный manifest.json."); }
    const checked = validateNativeManifest(manifestValue);
    if (!checked.ok) return { ok: false, error: checked.error };
    const manifest = checked.value;
    const documentBytes = await read("document.json", ARCHIVE_LIMITS.document);
    if (await sha(documentBytes) !== manifest.document.sha256.toLowerCase()) return fail("ASSET_INTEGRITY", "Хеш документа не совпадает.");
    const document = deserializeProjectDocument(decoder.decode(documentBytes));
    if (!document.ok) return { ok: false, error: document.error };
    const consistency = checkAssets(document.value, manifest);
    if (!consistency.ok) return consistency;
    for (const asset of manifest.assets) {
      if (paths.get(folded(asset.path))?.filename !== asset.path) return fail("ASSET_MISSING", `Ресурс «${asset.id}» отсутствует в архиве.`, asset.path);
    }
    if (paths.size !== manifest.assets.length + 2) return fail("FILE_INVALID", "Архив содержит необъявленные ресурсы.");
    const assets = new AssetBytes();
    for (const asset of manifest.assets) {
      const bytes = await read(asset.path, ARCHIVE_LIMITS.asset);
      if (forbiddenPayload(bytes)) return fail("FILE_INVALID", "Вложенный архив или исполняемый ресурс запрещён.", asset.path);
      if (await sha(bytes) !== asset.sha256.toLowerCase()) return fail("ASSET_INTEGRITY", `Хеш ресурса «${asset.id}» не совпадает.`, asset.path);
      assets.set(asset.id, bytes);
    }
    return { ok: true, value: { project: document.value, assets } };
  } catch { return fail("FILE_INVALID", "Архив повреждён или превышает лимит распаковки."); }
  finally { await reader.close(); }
}
