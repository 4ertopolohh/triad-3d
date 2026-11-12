import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { imageDimensions, withinImageBudget } from "../assets/image-dimensions";
import { FloatType, RGBAFormat } from "three";

self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; mediaType: string }>) => {
  try {
    const { bytes, mediaType } = event.data;
    const format = mediaType === "image/vnd.radiance" ? "hdr" : mediaType === "image/x-exr" ? "exr" : null;
    if (!format || bytes.byteLength > 64 * 1024 * 1024) throw new Error("Неподдерживаемое или слишком большое окружение.");
    const dimensions = imageDimensions(bytes, format);
    if (!dimensions || !withinImageBudget(...dimensions)) throw new Error("Размер HDRI превышает бюджет памяти.");
    const buffer = bytes.slice().buffer;
    const parsed = format === "hdr" ? new HDRLoader().setDataType(FloatType).parse(buffer) : new EXRLoader().setDataType(FloatType).parse(buffer);
    // HDRLoader returns implicit RGBA; EXRLoader reports its channel format explicitly.
    if (!parsed || parsed.width !== dimensions[0] || parsed.height !== dimensions[1] || parsed.format !== undefined && parsed.format !== RGBAFormat
      || !(parsed.data instanceof Float32Array) || parsed.data.length !== dimensions[0] * dimensions[1] * 4
      || !parsed.data.every(Number.isFinite)) throw new Error("Не удалось прочитать RGBA HDRI.");
    self.postMessage({ ok: true, width: parsed.width, height: parsed.height, data: parsed.data, flipY: parsed.flipY ?? false }, { transfer: [parsed.data.buffer] });
  } catch (error) { self.postMessage({ ok: false, message: error instanceof Error ? error.message : "Ошибка декодирования HDRI." }); }
};
