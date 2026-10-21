import type { Asset, EntityId, MeshNode, MeshSource, Modifier, Node, Project, Transform, Vec3 } from "./types";
import { validateProject, type ValidationIssue } from "./validate-project";
import type { BooleanParameters } from "../geometry/modifiers/types";
import type { ArrayParameters } from "../geometry/modifiers/types";
import { parseArrayParameters } from "../geometry/modifiers/array";
import type { MirrorParameters } from "../geometry/modifiers/types";
import { parseMirrorParameters } from "../geometry/modifiers/mirror";
import { validatePrimitiveSource, type PrimitiveSource } from "../geometry/primitives";
import { convertPrimitiveToEditable, scaleEditableVertices, translateEditableVertices, validateEditableSource } from "../geometry/mesh-edit";
import { Matrix4, Quaternion, Vector3 } from "three";

export type ProjectCommand =
  | { commandId: string; type: "ADD_NODE"; targetIds: [EntityId, EntityId]; payload: { parentId: EntityId; node: Node } }
  | { commandId: string; type: "ADD_MESH_ASSET"; targetIds: [EntityId, EntityId, EntityId]; payload: { parentId: EntityId; node: MeshNode; asset: Asset | null } }
  | { commandId: string; type: "RENAME_NODE"; targetIds: [EntityId]; payload: { nodeId: EntityId; name: string } }
  | { commandId: string; type: "SET_NODE_TRANSFORM"; targetIds: [EntityId]; payload: { nodeId: EntityId; transform: Transform } }
  | { commandId: string; type: "SET_NODE_FLAGS"; targetIds: [EntityId]; payload: { nodeId: EntityId; visible?: boolean; locked?: boolean } }
  | { commandId: string; type: "SET_PRIMITIVE_PARAMETERS"; targetIds: [EntityId]; payload: { nodeId: EntityId; source: PrimitiveSource } }
  | { commandId: string; type: "CONVERT_PRIMITIVE_TO_EDITABLE"; targetIds: [EntityId]; payload: { nodeId: EntityId } }
  | { commandId: string; type: "TRANSLATE_EDITABLE_VERTICES"; targetIds: [EntityId]; payload: { nodeId: EntityId; vertexIndices: number[]; delta: Vec3 } }
  | { commandId: string; type: "SCALE_EDITABLE_VERTICES"; targetIds: [EntityId]; payload: { nodeId: EntityId; vertexIndices: number[]; factors: Vec3 } }
  | { commandId: string; type: "MOVE_NODE"; targetIds: [EntityId, EntityId]; payload: { nodeId: EntityId; parentId: EntityId; index: number } }
  | { commandId: string; type: "GROUP_NODES"; targetIds: EntityId[]; payload: { nodeIds: EntityId[]; group: Node } }
  | { commandId: string; type: "UNGROUP_NODE"; targetIds: [EntityId]; payload: { nodeId: EntityId } }
  | { commandId: string; type: "DELETE_NODE"; targetIds: [EntityId]; payload: { nodeId: EntityId } }
  | { commandId: string; type: "ADD_BOOLEAN_MODIFIER"; targetIds: [EntityId, EntityId, EntityId]; payload: { nodeId: EntityId; modifierId: EntityId; operation: BooleanParameters["operation"]; cutterNodeId: EntityId } }
  | { commandId: string; type: "UPDATE_BOOLEAN_MODIFIER"; targetIds: [EntityId, EntityId]; payload: { modifierId: EntityId; operation: BooleanParameters["operation"]; cutterNodeId: EntityId } }
  | { commandId: string; type: "ADD_ARRAY_MODIFIER"; targetIds: [EntityId, EntityId]; payload: { nodeId: EntityId; modifierId: EntityId; parameters: ArrayParameters } }
  | { commandId: string; type: "UPDATE_ARRAY_MODIFIER"; targetIds: [EntityId]; payload: { modifierId: EntityId; parameters: ArrayParameters } }
  | { commandId: string; type: "ADD_MIRROR_MODIFIER"; targetIds: [EntityId, EntityId]; payload: { nodeId: EntityId; modifierId: EntityId; parameters: MirrorParameters } }
  | { commandId: string; type: "UPDATE_MIRROR_MODIFIER"; targetIds: [EntityId]; payload: { modifierId: EntityId; parameters: MirrorParameters } }
  | { commandId: string; type: "SET_MODIFIER_ENABLED"; targetIds: [EntityId]; payload: { modifierId: EntityId; enabled: boolean } }
  | { commandId: string; type: "MOVE_MODIFIER"; targetIds: [EntityId]; payload: { modifierId: EntityId; toIndex: number } }
  | { commandId: string; type: "REMOVE_MODIFIER"; targetIds: [EntityId]; payload: { modifierId: EntityId } };

export const CommandErrorCode = {
  REVISION_CONFLICT: "REVISION_CONFLICT",
  INVALID_COMMAND: "INVALID_COMMAND",
  INVALID_REFERENCE: "INVALID_REFERENCE",
  NODE_LOCKED: "NODE_LOCKED",
  NODE_HIDDEN: "NODE_HIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  JOB_BUSY: "JOB_BUSY",
} as const;
export type CommandErrorCode = typeof CommandErrorCode[keyof typeof CommandErrorCode];

export type PatchChange =
  | { kind: "addNode"; node: Node }
  | { kind: "removeNode"; node: Node }
  | { kind: "addAsset"; asset: Asset }
  | { kind: "removeAsset"; asset: Asset }
  | { kind: "addModifier"; modifier: Modifier; index: number }
  | { kind: "removeModifier"; modifier: Modifier; index: number }
  | { kind: "setModifier"; modifierId: EntityId; before: Modifier; after: Modifier }
  | { kind: "setModifierIds"; nodeId: EntityId; before: EntityId[]; after: EntityId[] }
  | { kind: "setNode"; nodeId: EntityId; field: "name" | "transform" | "visible" | "locked" | "children" | "parentId"; before: Node["name"] | Transform | boolean | EntityId[] | EntityId | null; after: Node["name"] | Transform | boolean | EntityId[] | EntityId | null }
  | { kind: "setMeshSource"; nodeId: EntityId; before: MeshSource; after: MeshSource }
  | { kind: "modelRevision"; before: number; after: number };
export interface ProjectPatch { changes: PatchChange[] }

export type CommandResult =
  | { ok: true; id: string; project: Project; revision: number; patch: ProjectPatch; undoPatch: ProjectPatch; changed: boolean }
  | { ok: false; id: string; code: CommandErrorCode; message: string; issues?: ValidationIssue[] };

export interface CommandBus {
  /** Session revision starts at 0, regardless of the serialized model revision. */
  getRevision(): number;
  getSnapshot(): Project;
  executeCommand(command: ProjectCommand, expectedRevision: number): CommandResult;
  executeTransaction(commands: ProjectCommand[], expectedRevision: number, transactionId?: string): CommandResult;
  applyHistoryPatch(patch: ProjectPatch, expectedRevision: number): CommandResult;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const idList = (value: unknown): value is string[] => Array.isArray(value) && value.every(id);
const numbers = (value: unknown, count: number): value is number[] =>
  Array.isArray(value) && value.length === count && value.every((item) => typeof item === "number" && Number.isFinite(item));
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const samePrimitive = (left: PrimitiveSource, right: PrimitiveSource): boolean => left.primitive === right.primitive
  && Object.keys(left.parameters).length === Object.keys(right.parameters).length
  && Object.keys(left.parameters).every(key => Object.hasOwn(right.parameters, key) && left.parameters[key] === right.parameters[key]);
const ownKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

function validTransform(value: unknown): value is Transform {
  return record(value) && ownKeys(value, ["position", "rotationQuat", "scale"])
    && numbers(value.position, 3) && numbers(value.rotationQuat, 4) && numbers(value.scale, 3);
}

function validNode(value: unknown): value is Node {
  if (!record(value) || !id(value.id) || !["group", "mesh"].includes(String(value.kind))) return false;
  const keys = ["id", "kind", "name", "parentId", "children", "transform", "visible", "locked", "materialSlots", "modifierIds"];
  if (!ownKeys(value, value.kind === "mesh" ? [...keys, "meshSource"] : keys)) return false;
  if (typeof value.name !== "string" || !value.name.trim() || !id(value.parentId) || !idList(value.children)
    || !validTransform(value.transform) || typeof value.visible !== "boolean" || typeof value.locked !== "boolean"
    || !Array.isArray(value.materialSlots) || !value.materialSlots.every((slot: unknown) =>
      record(slot) && ownKeys(slot, ["name", "materialId"]) && typeof slot.name === "string" && id(slot.materialId))
    || !idList(value.modifierIds)) return false;
  if (value.kind === "group") return true;
  const source = value.meshSource;
  if (!record(source)) return false;
  if (source.kind === "asset") return ownKeys(source, ["kind", "assetId"]) && id(source.assetId);
  if (source.kind === "editable") return validateEditableSource(source) === null;
  return source.kind === "primitive" && ownKeys(source, ["kind", "primitive", "parameters"])
    && validatePrimitiveSource(source) === null;
}

function validCommand(value: unknown): value is ProjectCommand {
  if (!record(value) || !id(value.commandId) || !Array.isArray(value.targetIds) || !record(value.payload)) return false;
  const payload = value.payload;
  if (!ownKeys(value, ["commandId", "type", "targetIds", "payload"])) return false;
  if (value.type === "ADD_BOOLEAN_MODIFIER") return ownKeys(payload, ["nodeId", "modifierId", "operation", "cutterNodeId"])
    && id(payload.nodeId) && id(payload.modifierId) && id(payload.cutterNodeId)
    && booleanOperation(payload.operation) && same(value.targetIds, [payload.nodeId, payload.modifierId, payload.cutterNodeId]);
  if (value.type === "UPDATE_BOOLEAN_MODIFIER") return ownKeys(payload, ["modifierId", "operation", "cutterNodeId"])
    && id(payload.modifierId) && id(payload.cutterNodeId) && booleanOperation(payload.operation)
    && same(value.targetIds, [payload.modifierId, payload.cutterNodeId]);
  if (value.type === "ADD_ARRAY_MODIFIER" || value.type === "UPDATE_ARRAY_MODIFIER") {
    try { parseArrayParameters(payload.parameters); } catch { return false; }
    return value.type === "ADD_ARRAY_MODIFIER"
      ? ownKeys(payload, ["nodeId", "modifierId", "parameters"]) && id(payload.nodeId) && id(payload.modifierId) && same(value.targetIds, [payload.nodeId, payload.modifierId])
      : ownKeys(payload, ["modifierId", "parameters"]) && id(payload.modifierId) && same(value.targetIds, [payload.modifierId]);
  }
  if (value.type === "ADD_MIRROR_MODIFIER" || value.type === "UPDATE_MIRROR_MODIFIER") {
    try { parseMirrorParameters(payload.parameters); } catch { return false; }
    return value.type === "ADD_MIRROR_MODIFIER"
      ? ownKeys(payload, ["nodeId", "modifierId", "parameters"]) && id(payload.nodeId) && id(payload.modifierId) && same(value.targetIds, [payload.nodeId, payload.modifierId])
      : ownKeys(payload, ["modifierId", "parameters"]) && id(payload.modifierId) && same(value.targetIds, [payload.modifierId]);
  }
  if (value.type === "SET_MODIFIER_ENABLED") return ownKeys(payload, ["modifierId", "enabled"])
    && id(payload.modifierId) && typeof payload.enabled === "boolean" && same(value.targetIds, [payload.modifierId]);
  if (value.type === "MOVE_MODIFIER") return ownKeys(payload, ["modifierId", "toIndex"])
    && id(payload.modifierId) && Number.isSafeInteger(payload.toIndex) && (payload.toIndex as number) >= 0
    && same(value.targetIds, [payload.modifierId]);
  if (value.type === "REMOVE_MODIFIER") return ownKeys(payload, ["modifierId"])
    && id(payload.modifierId) && same(value.targetIds, [payload.modifierId]);
  if (value.type === "GROUP_NODES") return ownKeys(payload, ["nodeIds", "group"]) && idList(payload.nodeIds)
    && payload.nodeIds.length > 0 && new Set(payload.nodeIds).size === payload.nodeIds.length
    && validNode(payload.group) && payload.group.kind === "group" && payload.group.children.length === 0
    && same(value.targetIds, [...payload.nodeIds, payload.group.id]);
  if (value.type === "MOVE_NODE") return ownKeys(payload, ["nodeId", "parentId", "index"])
    && id(payload.nodeId) && id(payload.parentId) && Number.isSafeInteger(payload.index) && (payload.index as number) >= 0
    && same(value.targetIds, [payload.nodeId, payload.parentId]);
  if (value.type === "UNGROUP_NODE" || value.type === "DELETE_NODE") return ownKeys(payload, ["nodeId"])
    && id(payload.nodeId) && same(value.targetIds, [payload.nodeId]);
  if (value.type === "ADD_MESH_ASSET") {
    const asset = payload.asset;
    const node = payload.node;
    return ownKeys(value, ["commandId", "type", "targetIds", "payload"])
      && ownKeys(payload, ["parentId", "node", "asset"]) && id(payload.parentId)
      && validNode(node) && node.kind === "mesh" && node.meshSource.kind === "asset"
      && (asset === null || (record(asset) && ownKeys(asset, ["id", "hash", "mediaType", "path", "colorSpace"])
        && id(asset.id) && /^[a-f0-9]{64}$/.test(String(asset.hash))
        && asset.path === `assets/${asset.hash}.glb` && asset.mediaType === "model/gltf-binary" && asset.colorSpace === "none"))
      && value.targetIds.length === 3 && value.targetIds[0] === payload.parentId
      && value.targetIds[1] === node.id && value.targetIds[2] === node.meshSource.assetId
      && (asset === null || asset.id === node.meshSource.assetId);
  }
  if (value.type === "ADD_NODE") return ownKeys(value, ["commandId", "type", "targetIds", "payload"])
    && ownKeys(payload, ["parentId", "node"]) && id(payload.parentId) && validNode(payload.node)
    && value.targetIds.length === 2 && value.targetIds[0] === payload.parentId && value.targetIds[1] === payload.node.id;
  if (!id(payload.nodeId) || value.targetIds.length !== 1 || value.targetIds[0] !== payload.nodeId
    || !ownKeys(value, ["commandId", "type", "targetIds", "payload"])) return false;
  switch (value.type) {
    case "CONVERT_PRIMITIVE_TO_EDITABLE": return ownKeys(payload, ["nodeId"]);
    case "TRANSLATE_EDITABLE_VERTICES": return ownKeys(payload, ["nodeId", "vertexIndices", "delta"])
      && Array.isArray(payload.vertexIndices) && payload.vertexIndices.length > 0
      && payload.vertexIndices.every((index: unknown) => Number.isSafeInteger(index) && (index as number) >= 0)
      && numbers(payload.delta, 3);
    case "SCALE_EDITABLE_VERTICES": return ownKeys(payload, ["nodeId", "vertexIndices", "factors"])
      && Array.isArray(payload.vertexIndices) && payload.vertexIndices.length > 0
      && payload.vertexIndices.every((index: unknown) => Number.isSafeInteger(index) && (index as number) >= 0)
      && numbers(payload.factors, 3);
    case "RENAME_NODE": return ownKeys(payload, ["nodeId", "name"]) && typeof payload.name === "string" && !!payload.name.trim();
    case "SET_NODE_TRANSFORM": return ownKeys(payload, ["nodeId", "transform"]) && validTransform(payload.transform);
    case "SET_PRIMITIVE_PARAMETERS": return ownKeys(payload, ["nodeId", "source"]) && record(payload.source)
      && ownKeys(payload.source, ["kind", "primitive", "parameters"]) && validatePrimitiveSource(payload.source) === null;
    case "SET_NODE_FLAGS": return ownKeys(payload, ["nodeId", "visible", "locked"])
      && (Object.hasOwn(payload, "visible") || Object.hasOwn(payload, "locked"))
      && (!Object.hasOwn(payload, "visible") || typeof payload.visible === "boolean")
      && (!Object.hasOwn(payload, "locked") || typeof payload.locked === "boolean");
    default: return false;
  }
}

const booleanOperation = (value: unknown): value is BooleanParameters["operation"] =>
  value === "subtract" || value === "union" || value === "intersect";

const nodeById = (project: Project, nodeId: string): Node | undefined => project.nodes.find(node => node.id === nodeId);
function matrix(transform: Transform): Matrix4 {
  return new Matrix4().compose(new Vector3(...transform.position), new Quaternion(...transform.rotationQuat), new Vector3(...transform.scale));
}
function worldMatrix(project: Project, node: Node): Matrix4 {
  const chain: Node[] = [];
  let current: Node | undefined = node;
  while (current) { chain.unshift(current); current = current.parentId ? nodeById(project, current.parentId) : undefined; }
  return chain.reduce((result, item) => result.multiply(matrix(item.transform)), new Matrix4());
}
function relativeTransform(project: Project, node: Node, parent: Node): Transform | null {
  const parentWorld = worldMatrix(project, parent);
  if (Math.abs(parentWorld.determinant()) < 1e-12) return null;
  const target = parentWorld.invert().multiply(worldMatrix(project, node));
  const position = new Vector3(); const rotation = new Quaternion(); const scale = new Vector3();
  target.decompose(position, rotation, scale);
  const recomposed = new Matrix4().compose(position, rotation, scale);
  if (![...target.elements, ...recomposed.elements].every(Number.isFinite)
    || target.elements.some((value, index) => Math.abs(value - recomposed.elements[index]!) > 1e-6 * Math.max(1, Math.abs(value)))) return null;
  return { position: position.toArray() as [number, number, number], rotationQuat: rotation.toArray() as [number, number, number, number], scale: scale.toArray() as [number, number, number] };
}
function descendants(project: Project, node: Node): Node[] {
  return [node, ...node.children.flatMap(childId => { const child = nodeById(project, childId); return child ? descendants(project, child) : []; })];
}
function guarded(project: Project, node: Node): CommandErrorCode | null { return blocked(project, node); }
function move(project: Project, node: Node, parent: Node, index: number, commandId: string): CommandResult | null {
  if (node.id === project.model.rootNodeId || parent.kind !== "group" || descendants(project, node).some(item => item.id === parent.id))
    return failure(commandId, CommandErrorCode.INVALID_COMMAND, "Корень и циклические переносы запрещены.");
  const oldParent = node.parentId && nodeById(project, node.parentId);
  if (!oldParent || index > parent.children.length || guarded(project, node) || guarded(project, oldParent) || guarded(project, parent))
    return failure(commandId, CommandErrorCode.INVALID_COMMAND, "Перенос запрещён: узел, родитель или позиция недоступны.");
  const transform = oldParent.id === parent.id ? node.transform : relativeTransform(project, node, parent);
  if (!transform) return failure(commandId, CommandErrorCode.INVALID_COMMAND, "Перенос создаёт недопустимый сдвиг (shear) или необратимую трансформацию.");
  const oldIndex = oldParent.children.indexOf(node.id);
  oldParent.children = oldParent.children.filter(id => id !== node.id);
  parent.children.splice(Math.min(index - (oldParent.id === parent.id && oldIndex < index ? 1 : 0), parent.children.length), 0, node.id);
  node.parentId = parent.id; node.transform = transform;
  return null;
}

function failure(idValue: string, code: CommandErrorCode, message: string, issues?: ValidationIssue[]): CommandResult {
  return { ok: false, id: idValue, code, message, ...(issues ? { issues } : {}) };
}

function blocked(project: Project, node: Node, flags = false): CommandErrorCode | null {
  let current: Node | undefined = node;
  while (current) {
    if (current.locked && (!flags || current.id !== node.id)) return CommandErrorCode.NODE_LOCKED;
    if (!current.visible && (!flags || current.id !== node.id)) return CommandErrorCode.NODE_HIDDEN;
    current = current.parentId === null ? undefined : project.nodes.find((entry) => entry.id === current?.parentId);
  }
  return null;
}

function bump(modifier: Modifier): boolean {
  if (!Number.isSafeInteger(modifier.version) || modifier.version >= Number.MAX_SAFE_INTEGER) return false;
  modifier.version += 1;
  return true;
}

function normalizeOrders(project: Project, node: MeshNode): boolean {
  for (const [index, modifierId] of node.modifierIds.entries()) {
    const modifier = project.modifiers.find(item => item.id === modifierId);
    if (!modifier) return false;
    if (modifier.order !== index) {
      modifier.order = index;
      if (!bump(modifier)) return false;
    }
  }
  return true;
}

function meshOperand(project: Project, nodeId: string): MeshNode | undefined {
  const node = nodeById(project, nodeId);
  return node?.kind === "mesh" && !(node.meshSource.kind === "primitive" && node.meshSource.primitive === "plane") ? node : undefined;
}

function activeDependents(project: Project, nodeId: string): boolean {
  return project.modifiers.some(m => m.enabled && m.kind === "boolean" && m.parameters.cutterNodeId === nodeId);
}

function applyCommand(project: Project, command: ProjectCommand): CommandResult | null {
  if (command.type === "MOVE_NODE") {
    const node = nodeById(project, command.payload.nodeId); const parent = nodeById(project, command.payload.parentId);
    if (!node || !parent) return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Узел или новая группа не найдены.");
    return move(project, node, parent, command.payload.index, command.commandId);
  }
  if (command.type === "GROUP_NODES") {
    const nodes = command.payload.nodeIds.map(id => nodeById(project, id));
    const first = nodes[0]; const parent = first?.parentId && nodeById(project, first.parentId);
    const group = command.payload.group;
    if (!first || !parent || nodes.some(node => !node || node.id === project.model.rootNodeId || node.parentId !== parent.id)
      || group.parentId !== parent.id || parent.kind !== "group" || entityIds(project).has(group.id) || guarded(project, parent)
      || !same(group.transform, { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] })
      || nodes.some(node => guarded(project, node!)) || group.modifierIds.length || group.materialSlots.length)
      return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Группировать можно доступные узлы одного родителя.");
    const ordered = parent.children.filter(id => command.payload.nodeIds.includes(id));
    const insertion = parent.children.indexOf(ordered[0]!);
    parent.children = parent.children.filter(id => !ordered.includes(id)); parent.children.splice(insertion, 0, group.id);
    project.nodes.push(structuredClone(group));
    const created = nodeById(project, group.id)!;
    for (const id of ordered) { const node = nodeById(project, id)!; node.parentId = group.id; created.children.push(id); }
    return null;
  }
  if (command.type === "UNGROUP_NODE") {
    const group = nodeById(project, command.payload.nodeId);
    const parent = group?.parentId && nodeById(project, group.parentId);
    if (!group || !parent || group.kind !== "group" || group.id === project.model.rootNodeId || guarded(project, group)
      || guarded(project, parent) || group.modifierIds.length || group.materialSlots.length || project.tracks.some(track => track.nodeId === group.id))
      return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Группу нельзя безопасно разгруппировать.");
    const children = group.children.map(id => nodeById(project, id)!);
    const transforms = children.map(child => relativeTransform(project, child, parent));
    if (transforms.some(value => !value)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Разгруппировка создаёт shear или необратимую трансформацию.");
    const index = parent.children.indexOf(group.id);
    parent.children.splice(index, 1, ...group.children);
    children.forEach((child, i) => { child.parentId = parent.id; child.transform = transforms[i]!; });
    project.nodes = project.nodes.filter(node => node.id !== group.id);
    return null;
  }
  if (command.type === "DELETE_NODE") {
    const node = nodeById(project, command.payload.nodeId);
    const parent = node?.parentId && nodeById(project, node.parentId);
    if (!node || !parent || node.id === project.model.rootNodeId || guarded(project, node) || guarded(project, parent))
      return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Узел нельзя удалить.");
    const removed = descendants(project, node); const ids = new Set(removed.map(item => item.id));
    if (project.modifiers.some(item => item.kind === "boolean" && ids.has(String(item.parameters.cutterNodeId)) && !ids.has(item.nodeId)))
      return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Узел используется как Boolean cutter оставшимся модификатором.");
    if (removed.some(item => item.modifierIds.length) || project.modifiers.some(item => ids.has(item.nodeId))
      || project.tracks.some(item => ids.has(item.nodeId)))
      return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "У структуры есть зависимые дорожки или модификаторы.");
    parent.children = parent.children.filter(id => id !== node.id);
    project.nodes = project.nodes.filter(item => !ids.has(item.id));
    return null;
  }
  if (command.type === "ADD_NODE" || command.type === "ADD_MESH_ASSET") {
    const { parentId, node } = command.payload;
    if (command.type === "ADD_MESH_ASSET") {
      const { asset } = command.payload;
      const assetId = command.payload.node.meshSource.kind === "asset" ? command.payload.node.meshSource.assetId : "";
      if (asset === null) {
        if (!project.assets.some((entry) => entry.id === assetId && entry.mediaType === "model/gltf-binary"))
          return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Ресурс GLB не найден.");
      } else {
        if (entityIds(project).has(asset.id) || asset.id === node.id || project.assets.some((entry) => entry.path === asset.path))
          return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "ID или путь ресурса уже используется.");
        project.assets.push(structuredClone(asset));
      }
    }
    const parent = project.nodes.find((entry) => entry.id === parentId);
    if (!parent) return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Родительский узел не найден.");
    const block = blocked(project, parent);
    if (block) return failure(command.commandId, block, "Родительский узел недоступен для редактирования.");
    if (node.parentId !== parentId || node.children.length !== 0 || node.modifierIds.length !== 0)
      return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Добавляемый узел должен быть согласованным листом без модификаторов.");
    if (project.nodes.some((entry) => entry.id === node.id) || entityIds(project).has(node.id))
      return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "ID узла уже используется.");
    project.nodes = project.nodes.map((entry) => entry.id === parentId ? { ...entry, children: [...entry.children, node.id] } : entry);
    project.nodes.push(structuredClone(node));
    return null;
  }
  if (command.type === "ADD_ARRAY_MODIFIER" || command.type === "ADD_MIRROR_MODIFIER") {
    const { nodeId, modifierId, parameters } = command.payload;
    const target = nodeById(project, nodeId);
    if (!target || target.kind !== "mesh") return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Модификатор требует существующий mesh.");
    if (entityIds(project).has(modifierId)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "ID модификатора уже используется.");
    const block = blocked(project, target);
    if (block) return failure(command.commandId, block, "Целевой mesh недоступен для редактирования.");
    const last = project.modifiers.find(item => item.id === target.modifierIds.at(-1));
    const order = last ? last.order + 1 : 0;
    if (!Number.isSafeInteger(order)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Порядок стека переполнен.");
    project.modifiers.push({ id: modifierId, nodeId, kind: command.type === "ADD_ARRAY_MODIFIER" ? "array" : "mirror", order, enabled: true, version: 0,
      parameters: structuredClone(command.type === "ADD_ARRAY_MODIFIER" ? parseArrayParameters(parameters) : parseMirrorParameters(parameters)) });
    target.modifierIds.push(modifierId);
    return null;
  }
  if (command.type === "ADD_BOOLEAN_MODIFIER") {
    const { nodeId, modifierId, operation, cutterNodeId } = command.payload;
    const target = meshOperand(project, nodeId);
    if (!target || !meshOperand(project, cutterNodeId)) return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Boolean требует существующие замкнутые mesh-операнды.");
    if (nodeId === cutterNodeId || entityIds(project).has(modifierId)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Boolean не может ссылаться на себя; ID модификатора должен быть уникальным.");
    const block = blocked(project, target);
    if (block) return failure(command.commandId, block, "Целевой mesh недоступен для редактирования.");
    const last = project.modifiers.find(item => item.id === target.modifierIds.at(-1));
    const order = last ? last.order + 1 : 0;
    if (!Number.isSafeInteger(order)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Порядок стека переполнен.");
    project.modifiers.push({ id: modifierId, nodeId, kind: "boolean", order, enabled: true, version: 0, parameters: { operation, cutterNodeId } });
    target.modifierIds.push(modifierId);
    return null;
  }
  if (command.type === "UPDATE_BOOLEAN_MODIFIER" || command.type === "UPDATE_ARRAY_MODIFIER" || command.type === "UPDATE_MIRROR_MODIFIER" || command.type === "SET_MODIFIER_ENABLED"
    || command.type === "MOVE_MODIFIER" || command.type === "REMOVE_MODIFIER") {
    const modifier = project.modifiers.find(item => item.id === command.payload.modifierId);
    if (!modifier) return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Модификатор не найден.");
    const target = nodeById(project, modifier.nodeId);
    if (!target || target.kind !== "mesh" || !target.modifierIds.includes(modifier.id))
      return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Стек модификатора не найден.");
    const block = blocked(project, target);
    if (block) return failure(command.commandId, block, "Целевой mesh недоступен для редактирования.");
    if (command.type === "UPDATE_ARRAY_MODIFIER") {
      if (modifier.kind !== "array") return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Модификатор не является массивом.");
      const parameters = parseArrayParameters(command.payload.parameters);
      if (!same(parseArrayParameters(modifier.parameters), parameters)) {
        if (!bump(modifier)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Версия модификатора переполнена.");
        modifier.parameters = structuredClone(parameters);
      }
    } else if (command.type === "UPDATE_MIRROR_MODIFIER") {
      if (modifier.kind !== "mirror") return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Модификатор не является Mirror.");
      const parameters = parseMirrorParameters(command.payload.parameters);
      if (!same(parseMirrorParameters(modifier.parameters), parameters)) {
        if (!bump(modifier)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Версия модификатора переполнена.");
        modifier.parameters = structuredClone(parameters);
      }
    } else if (command.type === "UPDATE_BOOLEAN_MODIFIER") {
      if (modifier.kind !== "boolean") return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Модификатор не является Boolean.");
      const { operation, cutterNodeId } = command.payload;
      if (!meshOperand(project, cutterNodeId)) return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Boolean cutter не является замкнутым mesh.");
      if (cutterNodeId === target.id) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Boolean не может ссылаться на свой mesh.");
      if (modifier.parameters.operation !== operation || modifier.parameters.cutterNodeId !== cutterNodeId) {
        if (!bump(modifier)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Версия модификатора переполнена.");
        modifier.parameters = { operation, cutterNodeId };
      }
    } else if (command.type === "SET_MODIFIER_ENABLED") {
      if (modifier.enabled !== command.payload.enabled) {
        if (!bump(modifier)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Версия модификатора переполнена.");
        modifier.enabled = command.payload.enabled;
      }
    } else if (command.type === "MOVE_MODIFIER") {
      const { toIndex } = command.payload;
      if (toIndex >= target.modifierIds.length) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Индекс модификатора вне стека.");
      const oldIndex = target.modifierIds.indexOf(modifier.id);
      if (oldIndex !== toIndex) {
        target.modifierIds.splice(oldIndex, 1);
        target.modifierIds.splice(toIndex, 0, modifier.id);
        if (!normalizeOrders(project, target)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Порядок или версия модификатора недопустимы.");
      }
    } else {
      target.modifierIds = target.modifierIds.filter(item => item !== modifier.id);
      project.modifiers = project.modifiers.filter(item => item.id !== modifier.id);
      if (!normalizeOrders(project, target)) return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Порядок или версия модификатора недопустимы.");
    }
    return null;
  }
  const current = project.nodes.find((entry) => entry.id === command.payload.nodeId);
  if (!current) return failure(command.commandId, CommandErrorCode.INVALID_REFERENCE, "Целевой узел не найден.");
  const block = blocked(project, current, command.type === "SET_NODE_FLAGS");
  if (block) return failure(command.commandId, block, "Узел недоступен для редактирования.");
  if (command.type === "SET_NODE_FLAGS") {
    if (current.locked && command.payload.locked !== false)
      return failure(command.commandId, CommandErrorCode.NODE_LOCKED, "Для изменения узла сначала снимите его блокировку.");
    if (!current.visible && command.payload.visible !== true)
      return failure(command.commandId, CommandErrorCode.NODE_HIDDEN, "Для изменения узла сначала восстановите его видимость.");
  }
  let next: Node;
  switch (command.type) {
    case "RENAME_NODE": next = { ...current, name: command.payload.name }; break;
    case "SET_NODE_TRANSFORM": next = { ...current, transform: structuredClone(command.payload.transform) }; break;
    case "SET_PRIMITIVE_PARAMETERS":
      if (current.kind !== "mesh" || current.meshSource.kind !== "primitive")
        return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Узел не является параметрическим примитивом.");
      if (current.meshSource.primitive !== command.payload.source.primitive)
        return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Тип примитива нельзя изменить командой параметров.");
      next = samePrimitive(current.meshSource, command.payload.source) ? current
        : { ...current, meshSource: structuredClone(command.payload.source) }; break;
    case "CONVERT_PRIMITIVE_TO_EDITABLE":
      if (current.kind !== "mesh" || current.meshSource.kind !== "primitive")
        return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Преобразование требует параметрический примитив.");
      if (current.modifierIds.some(id => project.modifiers.find(m => m.id === id)?.enabled) || activeDependents(project, current.id))
        return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Перед преобразованием отключите активные модификаторы и зависимые Boolean.");
      try { next = { ...current, meshSource: convertPrimitiveToEditable(current.meshSource) }; }
      catch (error) { return failure(command.commandId, CommandErrorCode.VALIDATION_FAILED, error instanceof Error ? error.message : "Геометрия недопустима."); }
      break;
    case "TRANSLATE_EDITABLE_VERTICES":
    case "SCALE_EDITABLE_VERTICES":
      if (current.kind !== "mesh" || current.meshSource.kind !== "editable")
        return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Операция требует редактируемую сетку.");
      try {
        const source = command.type === "TRANSLATE_EDITABLE_VERTICES"
          ? translateEditableVertices(current.meshSource, command.payload.vertexIndices, command.payload.delta)
          : scaleEditableVertices(current.meshSource, command.payload.vertexIndices, command.payload.factors);
        if (source !== current.meshSource && (current.modifierIds.some(id => project.modifiers.find(m => m.id === id)?.enabled) || activeDependents(project, current.id)))
          return failure(command.commandId, CommandErrorCode.INVALID_COMMAND, "Перед редактированием отключите активные модификаторы и зависимые Boolean.");
        next = source === current.meshSource ? current : { ...current, meshSource: source };
      } catch (error) { return failure(command.commandId, CommandErrorCode.VALIDATION_FAILED, error instanceof Error ? error.message : "Геометрия недопустима."); }
      break;
    case "SET_NODE_FLAGS": next = { ...current,
      visible: command.payload.visible ?? current.visible,
      locked: command.payload.locked ?? current.locked }; break;
  }
  project.nodes = project.nodes.map((entry) => entry.id === current.id ? next : entry);
  return null;
}

function entityIds(project: Project): Set<string> {
  return new Set([project.id, project.model.id, project.scene.id,
    ...project.nodes.map((item) => item.id), ...project.modifiers.map((item) => item.id),
    ...project.materials.map((item) => item.id), ...project.assets.map((item) => item.id),
    ...project.scene.lights.map((item) => item.id), ...project.scene.instances.map((item) => item.id),
    ...project.animations.map((item) => item.id), ...project.tracks.map((item) => item.id),
    ...project.keyframes.map((item) => item.id)]);
}

function diff(before: Project, after: Project): ProjectPatch {
  const changes: PatchChange[] = [];
  for (const asset of after.assets) if (!before.assets.some((entry) => entry.id === asset.id)) changes.push({ kind: "addAsset", asset: structuredClone(asset) });
  for (const node of after.nodes) {
    const old = before.nodes.find((entry) => entry.id === node.id);
    if (!old) { changes.push({ kind: "addNode", node: structuredClone(node) }); continue; }
    if (!same(old.modifierIds, node.modifierIds)) changes.push({ kind: "setModifierIds", nodeId: node.id,
      before: structuredClone(old.modifierIds), after: structuredClone(node.modifierIds) });
    for (const field of ["name", "transform", "visible", "locked", "children", "parentId"] as const) {
      if (!same(old[field], node[field])) changes.push({ kind: "setNode", nodeId: node.id, field,
        before: structuredClone(old[field]), after: structuredClone(node[field]) });
    }
    if (old.kind === "mesh" && node.kind === "mesh" && !same(old.meshSource, node.meshSource))
      changes.push({ kind: "setMeshSource", nodeId: node.id, before: structuredClone(old.meshSource), after: structuredClone(node.meshSource) });
  }
  for (const [index, modifier] of [...before.modifiers.entries()].reverse()) if (!after.modifiers.some(item => item.id === modifier.id))
    changes.push({ kind: "removeModifier", modifier: structuredClone(modifier), index });
  for (const [index, modifier] of after.modifiers.entries()) {
    const old = before.modifiers.find(item => item.id === modifier.id);
    if (!old) changes.push({ kind: "addModifier", modifier: structuredClone(modifier), index });
    else if (!same(old, modifier)) changes.push({ kind: "setModifier", modifierId: modifier.id, before: structuredClone(old), after: structuredClone(modifier) });
  }
  for (const node of before.nodes) if (!after.nodes.some(entry => entry.id === node.id)) changes.push({ kind: "removeNode", node: structuredClone(node) });
  if (before.model.revision !== after.model.revision) changes.push({ kind: "modelRevision", before: before.model.revision, after: after.model.revision });
  return { changes };
}

function inverse(patch: ProjectPatch): ProjectPatch {
  return { changes: [...patch.changes].reverse().map((change): PatchChange => {
    if (change.kind === "addNode") return { kind: "removeNode", node: structuredClone(change.node) };
    if (change.kind === "removeNode") return { kind: "addNode", node: structuredClone(change.node) };
    if (change.kind === "addAsset") return { kind: "removeAsset", asset: structuredClone(change.asset) };
    if (change.kind === "removeAsset") return { kind: "addAsset", asset: structuredClone(change.asset) };
    if (change.kind === "addModifier") return { kind: "removeModifier", modifier: structuredClone(change.modifier), index: change.index };
    if (change.kind === "removeModifier") return { kind: "addModifier", modifier: structuredClone(change.modifier), index: change.index };
    if (change.kind === "modelRevision") return { kind: "modelRevision", before: change.after, after: change.before };
    if (change.kind === "setModifier") return { ...change, before: structuredClone(change.after), after: structuredClone(change.before) };
    if (change.kind === "setModifierIds") return { ...change, before: structuredClone(change.after), after: structuredClone(change.before) };
    if (change.kind === "setMeshSource") return { ...change, before: structuredClone(change.after), after: structuredClone(change.before) };
    return { ...change, before: structuredClone(change.after), after: structuredClone(change.before) };
  }) };
}

/** Replays a patch against a matching semantic base; throws on stale or invalid input. */
export function applyProjectPatch(project: Project, patch: ProjectPatch): Project {
  const result = structuredClone(project);
  for (const change of patch.changes) {
    if (change.kind === "addAsset") {
      if (entityIds(result).has(change.asset.id) || result.assets.some((asset) => asset.path === change.asset.path)) throw new Error("Patch asset conflict");
      result.assets.push(structuredClone(change.asset));
    } else if (change.kind === "removeAsset") {
      const index = result.assets.findIndex((asset) => asset.id === change.asset.id);
      if (index < 0 || !same(result.assets[index], change.asset)) throw new Error("Patch asset conflict");
      result.assets.splice(index, 1);
    } else if (change.kind === "addModifier") {
      if (entityIds(result).has(change.modifier.id)) throw new Error("Patch modifier ID conflict");
      if (change.index < 0 || change.index > result.modifiers.length) throw new Error("Patch modifier index conflict");
      result.modifiers.splice(change.index, 0, structuredClone(change.modifier));
    } else if (change.kind === "removeModifier") {
      const index = result.modifiers.findIndex(item => item.id === change.modifier.id);
      if (index !== change.index || !same(result.modifiers[index], change.modifier)) throw new Error("Patch modifier conflict");
      result.modifiers.splice(index, 1);
    } else if (change.kind === "setModifier") {
      const index = result.modifiers.findIndex(item => item.id === change.modifierId);
      if (index < 0 || !same(result.modifiers[index], change.before)) throw new Error("Patch modifier conflict");
      result.modifiers[index] = structuredClone(change.after);
    } else if (change.kind === "setModifierIds") {
      const node = result.nodes.find(item => item.id === change.nodeId);
      if (!node || !same(node.modifierIds, change.before)) throw new Error("Patch modifier stack conflict");
      node.modifierIds = structuredClone(change.after);
    } else if (change.kind === "addNode") {
      if (entityIds(result).has(change.node.id)) throw new Error("Patch ID conflict");
      result.nodes.push(structuredClone(change.node));
    } else if (change.kind === "removeNode") {
      const index = result.nodes.findIndex((node) => node.id === change.node.id);
      if (index < 0 || !same(result.nodes[index], change.node)) throw new Error("Patch node conflict");
      result.nodes.splice(index, 1);
    } else if (change.kind === "modelRevision") {
      if (result.model.revision !== change.before) throw new Error("Patch revision conflict");
      result.model.revision = change.after;
    } else if (change.kind === "setMeshSource") {
      const node = result.nodes.find((entry) => entry.id === change.nodeId);
      if (!node || node.kind !== "mesh" || !same(node.meshSource, change.before)) throw new Error("Patch mesh source conflict");
      node.meshSource = structuredClone(change.after);
    } else {
      const node = result.nodes.find((entry) => entry.id === change.nodeId);
      if (!node || !same(node[change.field], change.before)) throw new Error("Patch field conflict");
      Object.assign(node, { [change.field]: structuredClone(change.after) });
    }
  }
  if (validateProject(result).length) throw new Error("Patch produces invalid project");
  return result;
}

export function createCommandBus(initialProject: Project): CommandBus {
  const initial = structuredClone(initialProject);
  const issues = validateProject(initial);
  if (issues.length) throw new Error(`Invalid initial project: ${issues[0]?.message}`);
  let committed = initial;
  let revision = 0;
  const executeTransaction = (commands: ProjectCommand[], expectedRevision: number, transactionId?: string): CommandResult => {
    const resultId = transactionId ?? (Array.isArray(commands) && commands.length === 1 && id(commands[0]?.commandId)
      ? commands[0].commandId : "transaction");
    if (expectedRevision !== revision) return failure(resultId, CommandErrorCode.REVISION_CONFLICT, "Ревизия документа изменилась.");
    if (!Array.isArray(commands) || commands.length === 0 || !commands.every(validCommand)
      || new Set(commands.map((command) => command.commandId)).size !== commands.length)
      return failure(resultId, CommandErrorCode.INVALID_COMMAND, "Некорректная команда или транзакция.");
    try {
      const candidate = structuredClone(committed);
      for (const command of commands) {
        const error = applyCommand(candidate, command);
        if (error) return error;
      }
      const contentPatch = diff(committed, candidate);
      if (contentPatch.changes.length === 0) return { ok: true, id: resultId, project: structuredClone(committed), revision,
        patch: { changes: [] }, undoPatch: { changes: [] }, changed: false };
      candidate.model.revision += 1;
      const validationIssues = validateProject(candidate);
      if (validationIssues.length) return failure(resultId, CommandErrorCode.VALIDATION_FAILED, "Результат не прошёл проверку документа.", validationIssues);
      const patch = diff(committed, candidate);
      const undoPatch = inverse(patch);
      committed = candidate;
      revision += 1;
      return { ok: true, id: resultId, project: structuredClone(committed), revision,
        patch: structuredClone(patch), undoPatch: structuredClone(undoPatch), changed: true };
    } catch {
      return failure(resultId, CommandErrorCode.INTERNAL_ERROR, "Не удалось выполнить транзакцию.");
    }
  };
  return {
    getRevision: () => revision,
    getSnapshot: () => structuredClone(committed),
    executeCommand: (command, expectedRevision) => executeTransaction([command], expectedRevision),
    executeTransaction,
    applyHistoryPatch(patch, expectedRevision) {
      if (expectedRevision !== revision) return failure("history", CommandErrorCode.REVISION_CONFLICT, "Ревизия документа изменилась.");
      try {
        if (!patch || !Array.isArray(patch.changes) || patch.changes.length === 0)
          return failure("history", CommandErrorCode.INVALID_COMMAND, "Пустой патч истории.");
        const candidate = applyProjectPatch(committed, patch);
        if (same(candidate, committed))
          return failure("history", CommandErrorCode.INVALID_COMMAND, "Патч истории не изменяет документ.");
        const issues = validateProject(candidate);
        if (issues.length) return failure("history", CommandErrorCode.VALIDATION_FAILED, "Результат истории не прошёл проверку.", issues);
        const project = structuredClone(candidate);
        const forward = structuredClone(patch);
        const undoPatch = inverse(forward);
        committed = candidate;
        revision += 1;
        return { ok: true, id: "history", project, revision, patch: forward, undoPatch, changed: true };
      } catch {
        return failure("history", CommandErrorCode.VALIDATION_FAILED, "Патч истории не соответствует документу.");
      }
    },
  };
}
