import type { Scene } from "./types";

export type SceneSettings = Pick<Scene, "camera" | "background" | "lights" | "renderSettings">;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fields = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(key => keys.includes(key));
const number = (v: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const vector = (v: unknown, min = -Number.MAX_VALUE) => Array.isArray(v) && v.length === 3 && v.every(n => number(n, min));

/** Runtime boundary shared by commands and document validation. Angles are radians. */
export function sceneSettingsError(value: unknown): string | null {
  if (!object(value) || !fields(value, ["camera", "background", "lights", "renderSettings"])) return "Некорректная структура настроек сцены.";
  const { camera: c, background: b, lights, renderSettings: r } = value;
  if (!object(c) || !fields(c, ["projection", "position", "target", "fovDegrees", "near", "far"]) || c.projection !== "perspective"
    || !vector(c.position) || !vector(c.target) || !number(c.fovDegrees) || c.fovDegrees <= 0 || c.fovDegrees >= 180 || !number(c.near) || c.near <= 0 || !number(c.far) || c.far <= c.near)
    return "Камера: угол больше 0° и меньше 180°, near > 0 и far > near; координаты должны быть конечными.";
  if ((c.position as number[]).every((n, i) => n === (c.target as number[])[i])) return "Положение камеры и её цель не должны совпадать.";
  if (!object(b) || !fields(b, ["color", "intensity", "environmentAssetId", "environmentIntensity", "environmentRotation"])
    || !vector(b.color, 0) || !number(b.intensity, 0) || b.environmentAssetId !== undefined && (typeof b.environmentAssetId !== "string" || !b.environmentAssetId.trim())
    || b.environmentIntensity !== undefined && !number(b.environmentIntensity, 0, 100) || b.environmentRotation !== undefined && !number(b.environmentRotation, -Math.PI * 2, Math.PI * 2))
    return "Некорректный фон, интенсивность HDRI (0–100) или поворот (−360…360°).";
  if (!Array.isArray(lights)) return "Ожидается список источников света.";
  for (const light of lights) {
    if (!object(light) || !fields(light, ["id", "kind", "color", "intensity", "position", "target"]) || typeof light.id !== "string" || !light.id.trim()
      || !["ambient", "directional", "point", "spot"].includes(String(light.kind)) || !vector(light.color, 0) || !number(light.intensity, 0)
      || !vector(light.position) || !vector(light.target)) return "Некорректные параметры источника света.";
    if (["directional", "spot"].includes(String(light.kind)) && (light.position as number[]).every((n, i) => n === (light.target as number[])[i]))
      return "Для направленного света положение и цель не должны совпадать.";
  }
  if (r !== undefined && (!object(r) || !fields(r, ["exposure", "toneMapping"]) || !number(r.exposure, .01, 20) || !["aces", "neutral", "none"].includes(String(r.toneMapping))))
    return "Экспозиция должна быть от 0,01 до 20; выберите поддерживаемый tone mapping.";
  return null;
}

export function sceneSettings(scene: Scene): SceneSettings {
  return { camera: scene.camera, background: scene.background, lights: scene.lights, ...(scene.renderSettings ? { renderSettings: scene.renderSettings } : {}) };
}
