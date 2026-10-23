import type { EditorStore } from "./editor-store";
import type { Material } from "../domain/types";
import type { ProjectCommand } from "../domain/command-bus";
import { validateMaterial } from "../domain/validate-material";
import { materialNodeReason } from "./material-actions";

export type MaterialField = Exclude<keyof Material, "id" | "name" | "textureAssetIds">;
export type MaterialEditMode = "unique" | "shared";
export interface MaterialEditContext {
  epoch: object; revision: number; nodeId: string; materialId: string; slotName: string; mode: MaterialEditMode;
}
export type MaterialEditResult = { ok: true; revision: number; changed: boolean } | { ok: false; message: string };

export function materialUsage(store: EditorStore, materialId: string) {
  return store.getSnapshot().document.project.nodes.flatMap(node => node.materialSlots.filter(slot => slot.materialId === materialId).map(slot => ({ nodeId: node.id, slotName: slot.name })));
}

export function captureMaterialEdit(store: EditorStore, mode: MaterialEditMode = "unique"): MaterialEditContext | null {
  const state = store.getSnapshot();
  const nodeId = state.selection.activeId;
  if (!nodeId || state.selection.ids.length !== 1) return null;
  const node = state.document.project.nodes.find(item => item.id === nodeId);
  if (node?.kind !== "mesh" || node.materialSlots.length !== 1) return null;
  return { epoch: store.getProjectEpoch(), revision: state.document.revision, nodeId, materialId: node.materialSlots[0]!.materialId, slotName: node.materialSlots[0]!.name, mode };
}

export function editMaterial(store: EditorStore, context: MaterialEditContext, field: MaterialField, value: number | readonly number[], groupId?: string): MaterialEditResult {
  const state = store.getSnapshot();
  if (store.getProjectEpoch() !== context.epoch || state.document.revision !== context.revision
    || state.selection.ids.length !== 1 || state.selection.activeId !== context.nodeId)
    return { ok: false, message: "Проект или выбор изменился. Повторите действие." };
  const reason = materialNodeReason(store, context.nodeId);
  if (reason) return { ok: false, message: reason };
  const project = state.document.project;
  const node = project.nodes.find(item => item.id === context.nodeId);
  if (node?.kind !== "mesh" || node.materialSlots.length !== 1 || node.materialSlots[0]?.name !== context.slotName || node.materialSlots[0]?.materialId !== context.materialId)
    return { ok: false, message: "Назначение материала изменилось. Повторите действие." };
  const source = project.materials.find(item => item.id === context.materialId);
  if (!source) return { ok: false, message: "Материал больше не существует." };
  const users = materialUsage(store, source.id);
  if (context.mode === "shared") for (const user of users) {
    const access = materialNodeReason(store, user.nodeId);
    if (access) return { ok: false, message: `Общее редактирование недоступно: ${access}` };
  }
  const next = structuredClone(source) as Material;
  if (field === "baseColor" || field === "emissive") {
    if (!Array.isArray(value) || value.length !== 3) return { ok: false, message: "Укажите три компонента цвета." };
    next[field] = [value[0]!, value[1]!, value[2]!];
  } else {
    if (typeof value !== "number") return { ok: false, message: "Укажите число." };
    next[field] = value;
  }
  if (field === "transmission" && typeof value === "number" && value > 0) next.opacity = 1;
  if (field === "opacity" && typeof value === "number" && value < 1 && next.transmission > 0)
    return { ok: false, message: "При transmission больше 0 непрозрачность должна быть 1." };
  const issues = validateMaterial(next);
  if (issues.length) return { ok: false, message: issues[0]!.message };
  if (JSON.stringify(next) === JSON.stringify(source)) return { ok: true, revision: context.revision, changed: false };
  const commands: ProjectCommand[] = [];
  if (users.length > 1 && context.mode === "unique") {
    let id = crypto.randomUUID();
    const used = new Set([...project.nodes, ...project.materials, ...project.assets, ...project.modifiers].map(item => item.id));
    while (used.has(id)) id = crypto.randomUUID();
    next.id = id;
    commands.push({ commandId: crypto.randomUUID(), type: "ADD_MATERIAL", targetIds: [id], payload: { material: next } });
    commands.push({ commandId: crypto.randomUUID(), type: "SET_MATERIAL_SLOT", targetIds: [node.id, id], payload: { nodeId: node.id, slotName: context.slotName, materialId: id } });
  } else commands.push({ commandId: crypto.randomUUID(), type: "UPDATE_MATERIAL", targetIds: [source.id], payload: { material: next } });
  const result = store.executeTransaction(commands, context.revision, crypto.randomUUID(), groupId);
  return result.ok ? { ok: true, revision: result.revision, changed: result.changed } : { ok: false, message: result.message };
}
