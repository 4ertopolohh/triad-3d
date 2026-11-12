import * as T from "three";
import type { Asset, SceneBackground } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";

export type EnvironmentDecoder = (bytes: Uint8Array, mediaType: string, signal: AbortSignal) => Promise<T.DataTexture>;
export const decodeEnvironment: EnvironmentDecoder = (bytes, mediaType, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error("Загрузка окружения отменена.")); return; }
  const worker = new Worker(new URL("./environment.worker.ts", import.meta.url), { type: "module" });
  const finish = () => { worker.terminate(); signal.removeEventListener("abort", cancel); };
  const cancel = () => { finish(); reject(new Error("Загрузка окружения отменена.")); };
  signal.addEventListener("abort", cancel, { once: true });
  worker.onerror = () => { finish(); reject(new Error("Сбой обработчика HDRI.")); };
  worker.onmessageerror = () => { finish(); reject(new Error("Не удалось получить данные HDRI.")); };
  worker.onmessage = (event: MessageEvent<{ ok: boolean; message?: string; width: number; height: number; data: Float32Array; flipY: boolean }>) => {
    finish();
    if (!event.data.ok) { reject(new Error(event.data.message ?? "Ошибка HDRI.")); return; }
    const { data, width, height } = event.data;
    const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.FloatType);
    texture.mapping = T.EquirectangularReflectionMapping;
    texture.colorSpace = T.LinearSRGBColorSpace;
    texture.flipY = event.data.flipY;
    texture.minFilter = T.LinearFilter; texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    resolve(texture);
  };
  const copy = bytes.slice();
  try { worker.postMessage({ bytes: copy, mediaType }, [copy.buffer]); }
  catch (error) { finish(); reject(error); }
});

/** Owns only derived resources; late loads can never attach to a different project. */
export class EnvironmentTexture {
  private key = "";
  private request: AbortController | undefined;
  private texture: T.DataTexture | undefined;
  private fallback = new T.HemisphereLight(0xffffff, 0x444444, 1);
  loading = false;
  diagnostic: string | undefined;
  constructor(private scene: T.Scene, private report: () => void, private decode: EnvironmentDecoder = decodeEnvironment) {}
  sync(background: DeepReadonly<SceneBackground>, assets: readonly DeepReadonly<Asset>[], read: (id: string) => Uint8Array | undefined): void {
    this.scene.environmentIntensity = background.environmentIntensity ?? 1;
    this.scene.environmentRotation.set(0, background.environmentRotation ?? 0, 0);
    const asset = assets.find(a => a.id === background.environmentAssetId);
    const key = background.environmentAssetId ? JSON.stringify([background.environmentAssetId, asset?.hash, asset?.mediaType]) : "";
    if (key === this.key) return;
    this.clear(); this.key = key;
    if (!key) return;
    const bytes = asset && read(asset.id);
    if (!asset || !bytes || !["image/vnd.radiance", "image/x-exr"].includes(asset.mediaType)) { this.fail("Ресурс HDRI недоступен."); return; }
    const request = new AbortController(); this.request = request; this.loading = true;
    void Promise.resolve().then(() => this.decode(bytes, asset.mediaType, request.signal)).then(texture => {
      if (this.request !== request || request.signal.aborted) { texture.dispose(); return; }
      this.texture = texture; this.scene.environment = texture; this.loading = false; this.report();
    }).catch((error: unknown) => {
      if (this.request !== request || request.signal.aborted) return;
      this.fail(error instanceof Error ? error.message : "Ошибка HDRI.");
    });
  }
  private fail(message: string): void {
    this.loading = false; this.diagnostic = `${message} Используется нейтральный свет.`;
    this.scene.add(this.fallback); this.report();
  }
  clear(): void {
    this.request?.abort(); this.request = undefined; this.key = ""; this.loading = false; this.diagnostic = undefined;
    this.scene.environment = null; this.texture?.dispose(); this.texture = undefined; this.fallback.removeFromParent();
  }
}
