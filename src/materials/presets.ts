import type { Material } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";

export type MaterialCategory = "metal" | "glass" | "plastic" | "stone" | "abstract";
export interface MaterialPreset { id: string; name: string; category: MaterialCategory; description: string; keywords: string; material: Omit<Material, "id"> }
export const categories: readonly { id: MaterialCategory; label: string }[] = [
  { id: "metal", label: "Металлы" }, { id: "glass", label: "Стекло" }, { id: "plastic", label: "Пластик" },
  { id: "stone", label: "Камень" }, { id: "abstract", label: "Абстрактные" },
];
// UI colors are specified in sRGB; the document and Three.Color use Linear-sRGB.
export function srgbChannelToLinear(value: number): number { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }
export function hexToLinear(hex: string): readonly [number, number, number] {
  const value = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error("Некорректный цвет пресета.");
  return [0, 2, 4].map(index => srgbChannelToLinear(parseInt(value.slice(index, index + 2), 16))) as [number, number, number];
}
const make = (id: string, name: string, category: MaterialCategory, description: string, color: string,
  params: Partial<Pick<Material, "metalness" | "roughness" | "transmission" | "ior" | "clearcoat" | "envIntensity" | "emissive">>, keywords = ""): MaterialPreset => ({
  id, name, category, description, keywords,
  material: { name, baseColor: hexToLinear(color), metalness: 0, roughness: .5, emissive: [0, 0, 0], opacity: 1,
    transmission: 0, ior: 1.5, clearcoat: 0, envIntensity: 1, textureAssetIds: [], ...params },
});
export const materialPresets: readonly MaterialPreset[] = [
  make("polished-chrome", "Полированный хром", "metal", "Зеркальный холодный металл", "#d8dce2", { metalness: 1, roughness: .07, envIntensity: 1.5 }, "хром зеркальный"),
  make("brushed-steel", "Сталь", "metal", "Сталь с мягкими отражениями", "#aeb6be", { metalness: 1, roughness: .34, envIntensity: 1.25 }, "металл"),
  make("clear-glass", "Прозрачное стекло", "glass", "Чистое стекло · IOR 1,5", "#edf7fa", { roughness: .025, transmission: 1, ior: 1.5, envIntensity: 1.2 }, "прозрачный"),
  make("matte-plastic", "Матовый пластик", "plastic", "Нейтральный пластик без бликов", "#6887a6", { roughness: .8, ior: 1.46 }, "полимер"),
  make("basic-stone", "Базовый камень", "stone", "Минеральная поверхность без текстуры", "#88867f", { roughness: .93, ior: 1.5 }, "матовый минерал"),
  make("emissive-violet", "Светящийся фиолетовый", "abstract", "Цветная эмиссия", "#321a63", { roughness: .38, emissive: hexToLinear("#b64aff") }, "свечение эмиссия"),
];
export function filterPresets(query: string, category: MaterialCategory | "all"): MaterialPreset[] {
  const normalized = query.trim().toLocaleLowerCase("ru");
  return materialPresets.filter(preset => (category === "all" || preset.category === category)
    && (!normalized || `${preset.name} ${preset.description} ${preset.keywords}`.toLocaleLowerCase("ru").includes(normalized)));
}
export function matchesPreset(material: DeepReadonly<Material>, preset: MaterialPreset): boolean {
  const { id: _id, name: _name, ...values } = material;
  void _id; void _name;
  const { name: _presetName, ...presetValues } = preset.material;
  void _presetName;
  return JSON.stringify(values) === JSON.stringify(presetValues);
}
