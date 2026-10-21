import * as T from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import hdriUrl from "../spikes/renderer/assets/studio_small_03_1k.hdr?url";
import { materialPresets } from "../materials/presets";
import { createPhysicalMaterial } from "./pbr-material";

export type PreviewResult = { images: Map<string, string>; warning: string | null };
let cache: Promise<PreviewResult> | undefined;
export function getMaterialPreviews(): Promise<PreviewResult> { return cache ??= renderPreviews(); }

async function renderPreviews(): Promise<PreviewResult> {
  const images = new Map<string, string>();
  let renderer: T.WebGLRenderer | undefined;
  let environment: T.DataTexture | undefined;
  const geometry = new T.SphereGeometry(.9, 48, 32);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(35, 1, .1, 10);
  camera.position.set(0, .15, 3.6); camera.lookAt(0, 0, 0);
  const sphere = new T.Mesh(geometry, new T.MeshPhysicalMaterial());
  scene.add(sphere);
  scene.add(new T.HemisphereLight(0xffffff, 0x60646d, 1.5));
  const key = new T.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);
  const rim = new T.DirectionalLight(0xddeaff, 1.3); rim.position.set(-3, 1, -2); scene.add(rim);
  let warning: string | null = null;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    renderer.setSize(180, 180, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    try {
      environment = await new RGBELoader().loadAsync(hdriUrl);
      environment.mapping = T.EquirectangularReflectionMapping;
      scene.environment = environment;
    } catch { warning = "HDRI недоступен. Превью показаны при нейтральном освещении."; }
    for (const preset of materialPresets) {
      const previous = sphere.material;
      sphere.material = createPhysicalMaterial({ ...preset.material, id: preset.id });
      previous.dispose();
      scene.background = new T.Color(preset.category === "glass" ? 0x57616d : 0x353b43);
      renderer.render(scene, camera);
      images.set(preset.id, renderer.domElement.toDataURL("image/png"));
    }
  } catch {
    warning = "3D-превью недоступны в этом браузере. Назначение материалов остаётся доступным.";
    images.clear();
  } finally {
    sphere.material.dispose(); geometry.dispose(); environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
  }
  return { images, warning };
}
