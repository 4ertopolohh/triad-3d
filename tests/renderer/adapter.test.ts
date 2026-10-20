import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebGPURenderer } from "three/webgpu";
import { ThreeRendererAdapter, type BackendMode, type RendererStatus } from "../../src/renderer/adapter";

class Canvas extends EventTarget {
  parent: Host | null = null;
  remove() { if (this.parent) { this.parent.canvases.delete(this); this.parent = null; } }
}
class Host {
  canvases = new Set<Canvas>(); clientWidth = 600; clientHeight = 400;
  append(canvas: Canvas) { this.canvases.add(canvas); canvas.parent = this; }
}
class Observer { observe() {} disconnect() {} }
const created: Array<{ canvas: Canvas; dispose: ReturnType<typeof vi.fn>; onDeviceLost?: (info: unknown) => void }> = [];
function factory(mode: BackendMode): WebGPURenderer {
  const canvas = new Canvas(); const dispose = vi.fn(async () => {});
  const fake = { domElement: canvas, backend: mode === "webgl2" ? { isWebGLBackend: true } : { isWebGPUBackend: true },
    init: async () => {}, render: vi.fn(), setPixelRatio: vi.fn(), setSize: vi.fn(), dispose, onDeviceLost: () => {} };
  created.push({ canvas, dispose });
  return fake as unknown as WebGPURenderer;
}
afterEach(() => { vi.unstubAllGlobals(); created.length = 0; });
describe("renderer lifecycle", () => {
  it("does not attach a canvas when unmounted during asynchronous initialization", async () => {
    vi.stubGlobal("ResizeObserver", Observer); vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const host = new Host();
    const adapter = new ThreeRendererAdapter(() => {}, () => {}, mode => {
      const renderer = factory(mode);
      renderer.init = () => waiting.then(() => renderer);
      return renderer;
    });
    const starting = adapter.initialize(host as unknown as HTMLElement, "auto");
    const cleaning = adapter.dispose();
    finish();
    await starting; await cleaning;
    expect(host.canvases.size).toBe(0);
    expect(created[0]!.dispose).toHaveBeenCalledOnce();
  });
  it("detects the initialized backend, reports loss, and releases exactly one canvas on retry", async () => {
    vi.stubGlobal("ResizeObserver", Observer); vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const host = new Host(); const states: RendererStatus[] = [];
    const first = new ThreeRendererAdapter(s => states.push(s), () => {}, factory);
    await first.initialize(host as unknown as HTMLElement, "auto");
    expect(states.at(-1)).toMatchObject({ phase: "ready", backend: "WebGPU" });
    expect(host.canvases.size).toBe(1);
    const event = new Event("webglcontextlost", { cancelable: true });
    created[0]!.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(states.at(-1)?.phase).toBe("lost");
    await first.dispose(); await first.dispose();
    expect(host.canvases.size).toBe(0);
    expect(created[0]!.dispose).toHaveBeenCalledOnce();
    const second = new ThreeRendererAdapter(s => states.push(s), () => {}, factory);
    await second.initialize(host as unknown as HTMLElement, "webgl2");
    expect(states.at(-1)).toMatchObject({ phase: "ready", backend: "WebGL2" });
    expect(host.canvases.size).toBe(1);
    await second.dispose();
    expect(host.canvases.size).toBe(0);
    expect(created[1]!.dispose).toHaveBeenCalledOnce();
  });
});
