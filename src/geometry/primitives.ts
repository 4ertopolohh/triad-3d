import type { MeshNode, MeshSource } from "../domain/types";

export type PrimitiveSource = Extract<MeshSource, { kind: "primitive" }>;
export type PrimitiveKind = PrimitiveSource["primitive"];
export type ParameterSpec = { label: string; defaultValue: number; min: number; max: number; integer?: boolean };
const dimension = (label: string, defaultValue: number): ParameterSpec => ({ label, defaultValue, min: Number.MIN_VALUE, max: 10000 });
const segment = (label: string, defaultValue: number, min = 3): ParameterSpec => ({ label, defaultValue, min, max: 128, integer: true });

export const primitiveDefinitions: Record<PrimitiveKind, { label: string; parameters: Record<string, ParameterSpec> }> = {
  cube: { label: "Куб", parameters: { size: dimension("Размер", 1), width: dimension("Ширина", 1), height: dimension("Высота", 1), depth: dimension("Глубина", 1) } },
  sphere: { label: "Сфера", parameters: { radius: dimension("Радиус", 1), widthSegments: segment("Сегменты по ширине", 32), heightSegments: segment("Сегменты по высоте", 16, 2) } },
  torus: { label: "Тор", parameters: { radius: dimension("Радиус", 1), tube: dimension("Радиус трубки", .25), radialSegments: segment("Радиальные сегменты", 16), tubularSegments: segment("Круговые сегменты", 48) } },
  cylinder: { label: "Цилиндр", parameters: { radiusTop: { ...dimension("Верхний радиус", 1), min: 0 }, radiusBottom: { ...dimension("Нижний радиус", 1), min: 0 }, height: dimension("Высота", 2), radialSegments: segment("Радиальные сегменты", 32) } },
  cone: { label: "Конус", parameters: { radius: dimension("Радиус", 1), height: dimension("Высота", 2), radialSegments: segment("Радиальные сегменты", 32) } },
  plane: { label: "Плоскость", parameters: { width: dimension("Ширина", 1), height: dimension("Высота", 1) } },
};

export function validatePrimitiveSource(source: unknown): string | null {
  if (!source || typeof source !== "object") return "Источник примитива отсутствует.";
  const value = source as Partial<PrimitiveSource>;
  if (Object.keys(value).some(key => !["kind", "primitive", "parameters"].includes(key))) return "Источник примитива содержит неподдерживаемое поле.";
  if (value.kind !== "primitive" || !value.primitive || !Object.hasOwn(primitiveDefinitions, value.primitive)) return "Неизвестный тип примитива.";
  if (!value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters)) return "Параметры примитива должны быть словарём.";
  const specs = primitiveDefinitions[value.primitive].parameters;
  for (const [key, input] of Object.entries(value.parameters)) {
    const spec = specs[key];
    if (!spec) return `Параметр «${key}» не поддерживается.`;
    if (typeof input !== "number" || !Number.isFinite(input) || input < spec.min || input > spec.max || spec.integer && !Number.isInteger(input))
      return `Параметр «${spec.label}» должен быть ${spec.integer ? "целым числом" : "числом"} ${spec.min === Number.MIN_VALUE ? "больше 0" : `от ${spec.min}`} до ${spec.max}.`;
  }
  if (value.primitive === "cylinder" && (value.parameters.radiusTop ?? 1) === 0 && (value.parameters.radiusBottom ?? 1) === 0)
    return "У цилиндра хотя бы один радиус должен быть больше нуля.";
  return null;
}

export function createPrimitiveSource(kind: PrimitiveKind): PrimitiveSource {
  if (!Object.hasOwn(primitiveDefinitions, kind)) throw new Error("Неизвестный тип примитива.");
  const keys = kind === "cube" ? ["size"] : Object.keys(primitiveDefinitions[kind].parameters);
  return { kind: "primitive", primitive: kind, parameters: Object.fromEntries(keys.map(key => [key, primitiveDefinitions[kind].parameters[key]!.defaultValue])) };
}

export function createPrimitiveNode(kind: PrimitiveKind, parentId: string, id: string): MeshNode {
  return { id, kind: "mesh", name: primitiveDefinitions[kind].label, parentId, children: [],
    transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
    visible: true, locked: false, materialSlots: [], modifierIds: [], meshSource: createPrimitiveSource(kind) };
}
