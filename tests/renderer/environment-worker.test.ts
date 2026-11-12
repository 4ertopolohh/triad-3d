import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("environment worker protocol with real decoders", () => {
  it.each([
    ["src/spikes/renderer/assets/studio_small_03_1k.hdr", "image/vnd.radiance", 1024, 512],
    ["tests/assets/sample.exr", "image/x-exr", 2, 2],
  ] as const)("decodes %s into finite RGBA float pixels", async (path, mediaType, width, height) => {
    const postMessage = vi.fn();
    const worker = { postMessage, onmessage: null as null | ((event: { data: { bytes: Uint8Array; mediaType: string } }) => void) };
    vi.stubGlobal("self", worker);
    await import("../../src/renderer/environment.worker");
    worker.onmessage!({ data: { bytes: new Uint8Array(readFileSync(path)), mediaType } });
    const output = postMessage.mock.calls[0]![0];
    expect(output).toMatchObject({ ok: true, width, height });
    expect(output.data).toBeInstanceOf(Float32Array);
    expect(output.data.length).toBe(width * height * 4);
    expect(postMessage.mock.calls[0]![1].transfer).toEqual([output.data.buffer]);
  }, 15000);
  it("rejects corrupt data before publishing a texture", async () => {
    const postMessage = vi.fn();
    const worker = { postMessage, onmessage: null as null | ((event: { data: { bytes: Uint8Array; mediaType: string } }) => void) };
    vi.stubGlobal("self", worker);
    await import("../../src/renderer/environment.worker");
    worker.onmessage!({ data: { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/vnd.radiance" } });
    expect(postMessage).toHaveBeenCalledWith({ ok: false, message: "Размер HDRI превышает бюджет памяти." });
  });
});
