import { WebGPURenderer, SRGBColorSpace, ACESFilmicToneMapping } from "three/webgpu";
import { SceneSync, type AssetReader, type RenderProject, type SceneStatus } from "./scene-sync";

export type BackendMode = "auto" | "webgl2";
export type RendererStatus = { phase: "initializing" | "ready" | "error" | "lost"; backend: string; message: string };
export interface RendererAdapter {
  initialize(container: HTMLElement, mode: BackendMode): Promise<void>;
  sync(project: RenderProject, readAsset: AssetReader, epoch?: object): void;
  resize(width: number, height: number): void;
  dispose(): Promise<void>;
}
// Factory is a small testing seam; production always uses the same Three renderer.
export type RendererFactory = (mode: BackendMode) => WebGPURenderer;
export class ThreeRendererAdapter implements RendererAdapter {
  readonly graph: SceneSync;
  private renderer: WebGPURenderer | undefined;
  private observer: ResizeObserver | undefined;
  private closed = false;
  private stopped = false;
  private initialized = false;
  private frame = 0;
  private backend = "не определён";
  private job: Promise<void> | undefined;
  private cleanupJob: Promise<void> | undefined;
  private removeListeners = () => {};
  constructor(private report: (state: RendererStatus) => void, sceneReport: (state: SceneStatus) => void,
    private factory: RendererFactory = mode => new WebGPURenderer({ antialias: true, forceWebGL: mode === "webgl2" })) {
    this.graph = new SceneSync(sceneReport);
  }
  initialize(container: HTMLElement, mode: BackendMode): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.job) return this.job;
    this.report({ phase: "initializing", backend: this.backend, message: "Инициализация 3D…" });
    this.job = this.start(container, mode);
    return this.job;
  }
  private fail(phase: "error" | "lost", message: string): void {
    if (this.closed) return;
    this.stopped = true; cancelAnimationFrame(this.frame);
    this.report({ phase, backend: this.backend, message });
  }
  private async start(container: HTMLElement, mode: BackendMode): Promise<void> {
    try {
      const renderer = this.factory(mode); this.renderer = renderer;
      renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
      const reportLoss = () => { if (!this.stopped) this.fail("lost", "Графический контекст потерян. Проект сохранён в памяти. Нажмите «Повторить запуск»."); };
      renderer.onDeviceLost = reportLoss;
      const lost = (event: Event) => { event.preventDefault(); reportLoss(); };
      const restored = () => { if (this.stopped) this.fail("lost", "Контекст доступен. Нажмите «Повторить запуск», чтобы восстановить вид из проекта."); };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      renderer.domElement.addEventListener("webglcontextrestored", restored);
      this.removeListeners = () => { renderer.domElement.removeEventListener("webglcontextlost", lost); renderer.domElement.removeEventListener("webglcontextrestored", restored); renderer.onDeviceLost = () => {}; };
      await renderer.init();
      this.initialized = true;
      if (this.closed || this.stopped) return;
      this.backend = "isWebGPUBackend" in renderer.backend && renderer.backend.isWebGPUBackend === true ? "WebGPU"
        : "isWebGLBackend" in renderer.backend && renderer.backend.isWebGLBackend === true ? "WebGL2" : "не определён";
      if (this.backend === "не определён") throw new Error("Неизвестный backend");
      container.append(renderer.domElement);
      const resize = () => this.resize(container.clientWidth, container.clientHeight);
      this.observer = new ResizeObserver(resize); this.observer.observe(container); resize();
      this.report({ phase: "ready", backend: this.backend, message: "Готово" });
      const draw = () => {
        if (this.closed || this.stopped) return;
        try { renderer.render(this.graph.scene, this.graph.camera); }
        catch { this.fail("error", "Ошибка отрисовки. Повторите запуск 3D; документ остаётся в памяти."); return; }
        this.frame = requestAnimationFrame(draw);
      };
      this.frame = requestAnimationFrame(draw);
    } catch {
      this.fail("error", "Не удалось запустить 3D backend. Попробуйте WebGL2 или повторите запуск.");
      this.removeListeners(); this.renderer?.domElement.remove();
      // Renderer.dispose in r186 does not release a backend whose init failed.
      // Release the partially initialized backend as well, without retrying initialization.
      if (this.renderer) {
        try {
          if (this.initialized) await this.renderer.dispose();
          else {
            const backend = this.renderer.backend as unknown as { dispose?: () => Promise<void> };
            await backend.dispose?.();
          }
        } catch { /* Partial backend may not own all internals yet. */ }
        this.renderer = undefined;
      }
    }
  }
  sync(project: RenderProject, readAsset: AssetReader, epoch?: object): void {
    if (this.closed) return;
    try { this.graph.sync(project, readAsset, epoch); }
    catch { this.fail("error", "Некорректные данные предпросмотра. Исправьте документ или повторите запуск."); }
  }
  resize(width: number, height: number): void {
    if (this.closed || this.stopped || !this.renderer) return;
    const w = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
    const h = Math.max(1, Math.floor(Number.isFinite(height) ? height : 1));
    this.graph.camera.aspect = w / h; this.graph.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1), 4096 / Math.max(w, h)));
    this.renderer.setSize(w, h, false);
  }
  dispose(): Promise<void> {
    if (this.cleanupJob) return this.cleanupJob;
    this.closed = true; cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.removeListeners();
    this.renderer?.domElement.remove(); this.graph.dispose();
    this.cleanupJob = (async () => { await this.job; this.removeListeners(); if (this.renderer) { try { await this.renderer.dispose(); } finally { this.renderer = undefined; } } })();
    return this.cleanupJob;
  }
}
