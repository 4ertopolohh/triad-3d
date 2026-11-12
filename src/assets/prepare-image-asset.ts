import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { ARCHIVE_LIMITS } from "./native-project-archive";
import type { Asset } from "../domain/types";

import { imageDimensions, withinImageBudget, type ImageFormat } from "./image-dimensions";
export { imageDimensions, withinImageBudget, IMAGE_LIMITS, type ImageFormat } from "./image-dimensions";

export interface PreparedImageAsset { asset: Asset; bytes: Uint8Array; width: number; height: number; format: ImageFormat }
export type ImageImportErrorCode = "FORMAT" | "MIME" | "SIZE" | "DIMENSIONS" | "DECODE" | "READ" | "HASH" | "CANCELLED";
export type ImageImportResult = { ok: true; value: PreparedImageAsset } | { ok: false; error: { code: ImageImportErrorCode; message: string } };
type Decoder = (bytes: Uint8Array, format: ImageFormat) => Promise<{ width: number; height: number }>;
const fail = (code: ImageImportErrorCode, message: string): ImageImportResult => ({ ok: false, error: { code, message } });
const mime: Record<ImageFormat, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", hdr: "image/vnd.radiance", exr: "image/x-exr" };
const aliases: Record<ImageFormat, string[]> = { png: ["image/png"], jpg: ["image/jpeg", "image/jpg"], webp: ["image/webp"], hdr: ["image/vnd.radiance", "image/x-hdr", "application/octet-stream"], exr: ["image/x-exr", "image/exr", "application/octet-stream"] };
export const browserImageDecoder: Decoder = async (bytes, format) => {
  if (format === "hdr" || format === "exr") {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = format === "hdr" ? new RGBELoader().parse(buffer) : new EXRLoader().parse(buffer);
    if (!result || !result.data || result.data.length === 0) throw new Error("decode");
    return { width: result.width ?? 0, height: result.height ?? 0 };
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime[format] }));
  try { return { width: bitmap.width, height: bitmap.height }; }
  finally { bitmap.close(); }
};
export async function prepareImageAsset(file: File, decoder: Decoder = browserImageDecoder, signal?: AbortSignal): Promise<ImageImportResult> {
  const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const format = extension === "jpeg" ? "jpg" : extension;
  if (!format || !(format in mime)) return fail("FORMAT", "Неподдерживаемое расширение ресурса.");
  const kind = format as ImageFormat;
  if (file.type && !aliases[kind].includes(file.type.toLowerCase())) return fail("MIME", "MIME-тип файла не соответствует расширению.");
  if (!file.size || file.size > ARCHIVE_LIMITS.asset) return fail("SIZE", "Файл пуст или превышает лимит 64 МиБ.");
  if (signal?.aborted) return fail("CANCELLED", "Импорт отменён.");
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { return fail("READ", "Не удалось прочитать файл."); }
  if (signal?.aborted) return fail("CANCELLED", "Импорт отменён.");
  const size = imageDimensions(bytes, kind);
  if (!size) return fail("FORMAT", "Заголовок или формат файла повреждён либо не поддерживается.");
  if (!withinImageBudget(...size)) return fail("DIMENSIONS", "Размеры изображения превышают защитный лимит декодирования 128 МиБ.");
  try {
    const decoded = await decoder(bytes, kind);
    if (decoded.width !== size[0] || decoded.height !== size[1] || !withinImageBudget(decoded.width, decoded.height))
      return fail("DIMENSIONS", "Размеры декодированного изображения не совпадают с заголовком.");
  } catch { return fail("DECODE", "Не удалось декодировать изображение; файл повреждён или использует неподдерживаемое кодирование."); }
  if (signal?.aborted) return fail("CANCELLED", "Импорт отменён.");
  let hash: string;
  try { hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map(n => n.toString(16).padStart(2, "0")).join(""); }
  catch { return fail("HASH", "Не удалось вычислить SHA-256 ресурса."); }
  if (signal?.aborted) return fail("CANCELLED", "Импорт отменён.");
  return { ok: true, value: { bytes, width: size[0], height: size[1], format: kind,
    asset: { id: crypto.randomUUID(), hash, path: `assets/${hash}.${kind}`, mediaType: mime[kind], colorSpace: kind === "hdr" || kind === "exr" ? "linear" : "srgb" } } };
}
