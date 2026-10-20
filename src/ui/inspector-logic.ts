import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { DeepReadonly, EditorState } from "../app/editor-store";
import type { ProjectCommand } from "../domain/command-bus";
import type { Node, Project, Transform, Vec3 } from "../domain/types";
import { primitiveDefinitions, validatePrimitiveSource, type PrimitiveSource } from "../geometry/primitives";

export type Space = "local" | "world";
export type Axis = 0 | 1 | 2;
export type TransformField = "position" | "rotation" | "scale";
export type Edit = { field: TransformField; axis: Axis; value: number } | { field: TransformField; reset: true };
export type EditSession = { revision: number; epoch: object; ids: string; mode: string; space: string; field: string; touched: boolean };
export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = <T>(message: string): Outcome<T> => ({ ok: false, message });
const RAD = Math.PI / 180;
const EPS = 1e-6;
const matrix = (transform: DeepReadonly<Transform>) => new Matrix4().compose(
  new Vector3(...transform.position), new Quaternion(...transform.rotationQuat), new Vector3(...transform.scale));

export function sessionCurrent(state: EditorState, epoch: object, captured: EditSession): boolean {
  return state.document.revision === captured.revision && epoch === captured.epoch
    && state.selection.ids.join("\u0000") === captured.ids && state.tool.mode === captured.mode
    && state.tool.space === captured.space && !["validating", "running", "applying"].includes(state.job.status);
}

export function accessReason(project: DeepReadonly<Project>, node: DeepReadonly<Node>, flags = false): string {
  let current: DeepReadonly<Node> | undefined = flags ? project.nodes.find(item => item.id === node.parentId) : node;
  while (current) {
    if (current.locked) return "Объект или его родитель заблокирован.";
    if (!current.visible) return "Объект или его родитель скрыт.";
    current = project.nodes.find(item => item.id === current?.parentId);
  }
  return "";
}

function worldMatrix(project: DeepReadonly<Project>, node: DeepReadonly<Node>): Matrix4 {
  const chain: DeepReadonly<Node>[] = [];
  let current: DeepReadonly<Node> | undefined = node;
  while (current) {
    chain.unshift(current);
    current = project.nodes.find(item => item.id === current?.parentId);
  }
  return chain.reduce((result, item) => result.multiply(matrix(item.transform)), new Matrix4());
}

function decompose(value: Matrix4): Outcome<Transform> {
  if (!value.elements.every(Number.isFinite) || Math.abs(value.determinant()) < 1e-12 || value.determinant() < 0)
    return fail("Трансформация вырождена или имеет отрицательный детерминант.");
  const p = new Vector3(); const q = new Quaternion(); const s = new Vector3();
  value.decompose(p, q, s);
  const composed = new Matrix4().compose(p, q, s);
  if (value.elements.some((entry, index) => Math.abs(entry - composed.elements[index]!) > 1e-6 * Math.max(1, Math.abs(entry))))
    return fail("Преобразование содержит shear и не представимо числовыми полями.");
  const transform: Transform = { position: p.toArray() as Vec3, rotationQuat: q.normalize().toArray() as Transform["rotationQuat"], scale: s.toArray() as Vec3 };
  return validateTransform(transform) ? { ok: true, value: transform } : fail("Недопустимое положение, вращение или масштаб.");
}

export function validateTransform(value: Transform): boolean {
  const numbers = [...value.position, ...value.rotationQuat, ...value.scale];
  const length = Math.hypot(...value.rotationQuat);
  return numbers.every(Number.isFinite) && Math.abs(length - 1) <= 1e-5 && value.scale.every(axis => axis >= EPS)
    && value.scale[0] * value.scale[1] * value.scale[2] > 0;
}

export function displayTransform(project: DeepReadonly<Project>, node: DeepReadonly<Node>, space: Space): Outcome<Transform> {
  return space === "local"
    ? validateTransform(node.transform as Transform) ? { ok: true, value: node.transform as Transform } : fail("Локальная трансформация содержит недопустимый масштаб или Quaternion.")
    : decompose(worldMatrix(project, node));
}

export function eulerDegrees(transform: DeepReadonly<Transform>): Vec3 {
  const euler = new Euler().setFromQuaternion(new Quaternion(...transform.rotationQuat), "XYZ");
  return [euler.x / RAD, euler.y / RAD, euler.z / RAD];
}

export function parseNumber(draft: string): Outcome<number> {
  const trimmed = draft.trim();
  if (!trimmed) return fail("Введите число.");
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? { ok: true, value } : fail("Введите конечное число.");
}

export function updatedPrimitiveSource(source: DeepReadonly<PrimitiveSource>, key: string, value: number): Outcome<PrimitiveSource> {
  if (!Object.hasOwn(primitiveDefinitions[source.primitive].parameters, key)) return fail("Неизвестный параметр примитива.");
  const parameters = source.primitive === "cube" && key !== "size"
    ? { width: source.parameters.width ?? source.parameters.size ?? primitiveDefinitions.cube.parameters.width!.defaultValue,
      height: source.parameters.height ?? source.parameters.size ?? primitiveDefinitions.cube.parameters.height!.defaultValue,
      depth: source.parameters.depth ?? source.parameters.size ?? primitiveDefinitions.cube.parameters.depth!.defaultValue, [key]: value }
    : { ...source.parameters, [key]: value };
  if (source.primitive === "cube" && key === "size") {
    delete parameters.width; delete parameters.height; delete parameters.depth;
  }
  const next: PrimitiveSource = { kind: "primitive", primitive: source.primitive, parameters };
  const issue = validatePrimitiveSource(next);
  return issue ? fail(issue) : { ok: true, value: next };
}

export function mixedValue(values: readonly number[], tolerance = 1e-6): number | null {
  const first = values[0];
  return first !== undefined && values.every(value => Math.abs(value - first) <= tolerance) ? first : null;
}

function editedTransform(base: Transform, edit: Edit): Outcome<Transform> {
  const position = [...base.position] as [number, number, number];
  const scale = [...base.scale] as [number, number, number];
  let rotationQuat: Transform["rotationQuat"] = base.rotationQuat;
  if ("reset" in edit) {
    if (edit.field === "position") position.splice(0, 3, 0, 0, 0);
    if (edit.field === "scale") scale.splice(0, 3, 1, 1, 1);
    if (edit.field === "rotation") rotationQuat = [0, 0, 0, 1];
  } else if (edit.field === "position") position[edit.axis] = edit.value;
  else if (edit.field === "scale") scale[edit.axis] = edit.value;
  else {
    const euler = new Euler().setFromQuaternion(new Quaternion(...base.rotationQuat), "XYZ");
    if (edit.axis === 0) euler.x = edit.value * RAD;
    if (edit.axis === 1) euler.y = edit.value * RAD;
    if (edit.axis === 2) euler.z = edit.value * RAD;
    rotationQuat = new Quaternion().setFromEuler(euler).normalize().toArray() as Transform["rotationQuat"];
  }
  const value = { position, rotationQuat, scale };
  return validateTransform(value) ? { ok: true, value } : fail("Масштаб должен быть не меньше 0,000001; все значения должны быть конечными.");
}

export function prepareTransformCommands(state: EditorState, edit: Edit, space: Space = state.tool.space): Outcome<ProjectCommand[]> {
  const project = state.document.project;
  if (state.tool.mode !== "model") return fail("В режиме «Сцена» трансформации модели недоступны.");
  if (!state.selection.ids.length) return fail("Выберите объект.");
  const ids = new Set(state.selection.ids);
  const nodes = state.selection.ids.map(id => project.nodes.find(node => node.id === id));
  if (nodes.some(node => !node)) return fail("Выделение изменилось.");
  if (space === "world" && nodes.some(node => { let parent = node?.parentId; while (parent) { if (ids.has(parent)) return true; parent = project.nodes.find(item => item.id === parent)?.parentId ?? null; } return false; }))
    return fail("Для мировой пакетной правки нельзя одновременно выбрать предка и потомка.");
  const commands: ProjectCommand[] = [];
  for (const node of nodes) {
    if (!node) return fail("Выделение изменилось.");
    if (node.id === project.model.rootNodeId) return fail("Корень модели защищён от трансформации.");
    const reason = accessReason(project, node);
    if (reason) return fail(reason);
    const displayed = displayTransform(project, node, space);
    if (!displayed.ok) return displayed;
    const edited = editedTransform(displayed.value, edit);
    if (!edited.ok) return edited;
    let transform = edited.value;
    if (space === "world") {
      const parent = project.nodes.find(item => item.id === node.parentId);
      const parentWorld = parent ? worldMatrix(project, parent) : new Matrix4();
      if (Math.abs(parentWorld.determinant()) < 1e-12) return fail("Преобразование родителя необратимо.");
      const local = decompose(parentWorld.invert().multiply(matrix(edited.value)));
      if (!local.ok) return local;
      transform = local.value;
    }
    commands.push({ commandId: crypto.randomUUID(), type: "SET_NODE_TRANSFORM", targetIds: [node.id], payload: { nodeId: node.id, transform } });
  }
  return { ok: true, value: commands };
}

export function prepareFlagCommands(state: EditorState, field: "visible" | "locked", value: boolean): Outcome<ProjectCommand[]> {
  if (state.tool.mode !== "model") return fail("В режиме «Сцена» свойства модели недоступны.");
  const project = state.document.project;
  const nodes = state.selection.ids.map(id => project.nodes.find(node => node.id === id));
  if (!nodes.length || nodes.some(node => !node)) return fail("Выделение изменилось.");
  for (const node of nodes) {
    if (!node) return fail("Выделение изменилось.");
    if (node.id === project.model.rootNodeId) return fail("Корень модели защищён.");
    const reason = accessReason(project, node, true);
    if (reason) return fail(reason);
    if (node.locked && !(field === "locked" && !value)) return fail("Сначала снимите блокировку объекта.");
    if (!node.visible && !(field === "visible" && value)) return fail("Сначала восстановите видимость объекта.");
  }
  const depth = (node: DeepReadonly<Node>) => {
    let count = 0;
    let parent = node.parentId;
    while (parent) { count++; parent = project.nodes.find(item => item.id === parent)?.parentId ?? null; }
    return count;
  };
  const childrenFirst = field === "locked" ? value : !value;
  const ordered = [...nodes] as DeepReadonly<Node>[];
  ordered.sort((a, b) => (depth(a) - depth(b)) * (childrenFirst ? -1 : 1));
  return { ok: true, value: ordered.map(node => ({ commandId: crypto.randomUUID(), type: "SET_NODE_FLAGS", targetIds: [node.id], payload: { nodeId: node.id, [field]: value } })) };
}
