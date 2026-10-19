import type { Asset, EntityId, MeshNode, Node, Project, Transform } from "./types";
import { validateProject, type ValidationIssue } from "./validate-project";

export type ProjectCommand =
  | { commandId: string; type: "ADD_NODE"; targetIds: [EntityId, EntityId]; payload: { parentId: EntityId; node: Node } }
  | { commandId: string; type: "ADD_MESH_ASSET"; targetIds: [EntityId, EntityId, EntityId]; payload: { parentId: EntityId; node: MeshNode; asset: Asset | null } }
  | { commandId: string; type: "RENAME_NODE"; targetIds: [EntityId]; payload: { nodeId: EntityId; name: string } }
  | { commandId: string; type: "SET_NODE_TRANSFORM"; targetIds: [EntityId]; payload: { nodeId: EntityId; transform: Transform } }
  | { commandId: string; type: "SET_NODE_FLAGS"; targetIds: [EntityId]; payload: { nodeId: EntityId; visible?: boolean; locked?: boolean } };

export const CommandErrorCode = {
  REVISION_CONFLICT: "REVISION_CONFLICT",
  INVALID_COMMAND: "INVALID_COMMAND",
  INVALID_REFERENCE: "INVALID_REFERENCE",
  NODE_LOCKED: "NODE_LOCKED",
  NODE_HIDDEN: "NODE_HIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
export type CommandErrorCode = typeof CommandErrorCode[keyof typeof CommandErrorCode];

export type PatchChange =
  | { kind: "addNode"; node: Node }
  | { kind: "removeNode"; node: Node }
  | { kind: "addAsset"; asset: Asset }
  | { kind: "removeAsset"; asset: Asset }
  | { kind: "setNode"; nodeId: EntityId; field: "name" | "transform" | "visible" | "locked" | "children"; before: Node["name"] | Transform | boolean | EntityId[]; after: Node["name"] | Transform | boolean | EntityId[] }
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
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const idList = (value: unknown): value is string[] => Array.isArray(value) && value.every(id);
const numbers = (value: unknown, count: number): value is number[] =>
  Array.isArray(value) && value.length === count && value.every((item) => typeof item === "number" && Number.isFinite(item));
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
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
  return source.kind === "primitive" && ownKeys(source, ["kind", "primitive", "parameters"])
    && ["cube", "sphere", "torus", "cylinder", "cone", "plane"].includes(String(source.primitive))
    && record(source.parameters) && Object.values(source.parameters).every((item) => typeof item === "number" && Number.isFinite(item));
}

function validCommand(value: unknown): value is ProjectCommand {
  if (!record(value) || !id(value.commandId) || !Array.isArray(value.targetIds) || !record(value.payload)) return false;
  const payload = value.payload;
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
    case "RENAME_NODE": return ownKeys(payload, ["nodeId", "name"]) && typeof payload.name === "string" && !!payload.name.trim();
    case "SET_NODE_TRANSFORM": return ownKeys(payload, ["nodeId", "transform"]) && validTransform(payload.transform);
    case "SET_NODE_FLAGS": return ownKeys(payload, ["nodeId", "visible", "locked"])
      && (Object.hasOwn(payload, "visible") || Object.hasOwn(payload, "locked"))
      && (!Object.hasOwn(payload, "visible") || typeof payload.visible === "boolean")
      && (!Object.hasOwn(payload, "locked") || typeof payload.locked === "boolean");
    default: return false;
  }
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

function applyCommand(project: Project, command: ProjectCommand): CommandResult | null {
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
    for (const field of ["name", "transform", "visible", "locked", "children"] as const) {
      if (!same(old[field], node[field])) changes.push({ kind: "setNode", nodeId: node.id, field,
        before: structuredClone(old[field]), after: structuredClone(node[field]) });
    }
  }
  if (before.model.revision !== after.model.revision) changes.push({ kind: "modelRevision", before: before.model.revision, after: after.model.revision });
  return { changes };
}

function inverse(patch: ProjectPatch): ProjectPatch {
  return { changes: [...patch.changes].reverse().map((change): PatchChange => {
    if (change.kind === "addNode") return { kind: "removeNode", node: structuredClone(change.node) };
    if (change.kind === "removeNode") return { kind: "addNode", node: structuredClone(change.node) };
    if (change.kind === "addAsset") return { kind: "removeAsset", asset: structuredClone(change.asset) };
    if (change.kind === "removeAsset") return { kind: "addAsset", asset: structuredClone(change.asset) };
    if (change.kind === "modelRevision") return { kind: "modelRevision", before: change.after, after: change.before };
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
  };
}
