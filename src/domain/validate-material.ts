import type { Material } from "./types";
import type { ValidationIssue } from "./validate-project";

/** Color components are stored in Linear-sRGB. Legacy textureAssetIds have no channel semantics. */
export function validateMaterial(value: unknown, path = "material"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string): void => { issues.push({ code: "INVALID_STRUCTURE", path: `${path}.${field}`, message }); };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add("", "Материал должен быть объектом."); return issues;
  }
  const material = value as Record<string, unknown>;
  const keys = ["id", "name", "baseColor", "metalness", "roughness", "emissive", "opacity", "transmission", "ior", "clearcoat", "envIntensity", "textureAssetIds"];
  if (keys.some(key => !(key in material)) || Object.keys(material).some(key => !keys.includes(key) && key !== "textureSlots" && key !== "textureMappings")) add("", "Структура материала содержит отсутствующие или лишние поля.");
  for (const field of ["id", "name"] as const) if (typeof material[field] !== "string" || !material[field].trim()) add(field, "Поле должно содержать непустую строку.");
  for (const field of ["baseColor", "emissive"] as const) {
    const color = material[field];
    if (!Array.isArray(color) || color.length !== 3 || color.some(component => typeof component !== "number" || !Number.isFinite(component) || component < 0))
      add(field, "Цвет Linear-sRGB должен содержать три конечных неотрицательных числа.");
  }
  for (const field of ["metalness", "roughness", "opacity", "transmission", "clearcoat"] as const) {
    const number = material[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) add(field, "Значение должно быть конечным числом от 0 до 1.");
  }
  if (typeof material.ior !== "number" || !Number.isFinite(material.ior) || material.ior < 1 || material.ior > 2.333)
    add("ior", "Показатель преломления должен быть от 1 до 2,333.");
  if (typeof material.envIntensity !== "number" || !Number.isFinite(material.envIntensity) || material.envIntensity < 0)
    add("envIntensity", "Интенсивность окружения должна быть конечным неотрицательным числом.");
  if (typeof material.transmission === "number" && material.transmission > 0 && material.opacity !== 1)
    add("opacity", "При передаче света transmission непрозрачность opacity должна быть равна 1.");
  if (!Array.isArray(material.textureAssetIds) || material.textureAssetIds.some(id => typeof id !== "string" || !id.trim())
    || new Set(material.textureAssetIds).size !== material.textureAssetIds.length)
    add("textureAssetIds", "Ссылки на текстуры должны быть непустыми и уникальными ID.");
  if (material.textureSlots !== undefined) {
    const slots = material.textureSlots;
    if (!slots || typeof slots !== "object" || Array.isArray(slots) || Object.keys(slots).some(key => key !== "baseColor")) add("textureSlots", "Неизвестный канал текстуры.");
    else if ("baseColor" in slots && (typeof (slots as Record<string, unknown>).baseColor !== "string" || !(slots as { baseColor: string }).baseColor.trim())) add("textureSlots.baseColor", "ID текстуры должен быть непустой строкой.");
  }
  if (material.textureMappings !== undefined) {
    const mappings = material.textureMappings;
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings) || Object.keys(mappings).some(key => key !== "baseColor")) add("textureMappings", "Неизвестный канал проекции.");
    else if ("baseColor" in mappings) {
      const projection = (mappings as Record<string, unknown>).baseColor;
      if (!projection || typeof projection !== "object" || Array.isArray(projection)) add("textureMappings.baseColor", "Некорректная проекция.");
      else {
        const config = projection as Record<string, unknown>;
        if (config.mode === "uv") {
          if (Object.keys(config).some(key => key !== "mode")) add("textureMappings.baseColor", "Режим UV не принимает параметры проекции.");
        } else if (config.mode === "planar" || config.mode === "box" || config.mode === "triplanar") {
          if (Object.keys(config).some(key => !(config.mode === "planar" ? ["mode", "axis", "tiling", "offset"] : ["mode", "tiling", "offset"]).includes(key))
            || config.mode === "planar" && !["x", "y", "z"].includes(config.axis as string)) add("textureMappings.baseColor", "Некорректная ось или поля проекции.");
          const pair = (value: unknown, positive: boolean) => Array.isArray(value) && value.length === 2 && value.every(number => typeof number === "number" && Number.isFinite(number) && (positive ? number > 0 && number <= 1024 : Math.abs(number) <= 100000));
          if (!pair(config.tiling, true)) add("textureMappings.baseColor.tiling", "Повторение должно содержать два конечных положительных числа не больше 1024.");
          if (!pair(config.offset, false)) add("textureMappings.baseColor.offset", "Смещение должно содержать два конечных числа по модулю не больше 100000.");
        } else add("textureMappings.baseColor.mode", "Неизвестный режим проекции.");
      }
    }
  }
  return issues;
}

export function isMaterial(value: unknown): value is Material { return validateMaterial(value).length === 0; }
