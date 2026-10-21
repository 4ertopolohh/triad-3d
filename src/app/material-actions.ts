import type { EditorStore } from "./editor-store";
import type { ProjectCommand } from "../domain/command-bus";
import { matchesPreset, type MaterialPreset } from "../materials/presets";
import { isJobActive } from "./job-controller";

export function materialTargetReason(store: EditorStore): string | null {
  const state = store.getSnapshot();
  if (state.tool.mode !== "model") return "Переключитесь в режим «Модель».";
  if (state.selection.ids.length !== 1 || !state.selection.activeId) return "Выберите один Mesh-объект.";
  const project = state.document.project;
  const node = project.nodes.find(item => item.id === state.selection.activeId);
  if (node?.kind !== "mesh") return "Выберите Mesh, а не группу.";
  if (node.meshSource.kind === "asset") return "Назначение материала импортированному GLB будет доступно при управлении слотами.";
  if (node.materialSlots.length > 1) return "У объекта несколько слотов материала.";
  let current: typeof project.nodes[number] | undefined = node;
  while (current) {
    if (current.locked) return "Объект или его родитель заблокирован.";
    if (!current.visible) return "Объект или его родитель скрыт.";
    current = project.nodes.find(item => item.id === current!.parentId);
  }
  if (isJobActive(state.job.status)) return "Дождитесь завершения операции.";
  return null;
}

export function applyMaterialPreset(store: EditorStore, preset: MaterialPreset, expectedRevision: number, expectedNodeId: string, expectedEpoch = store.getProjectEpoch()): { ok: boolean; message: string } {
  const state = store.getSnapshot();
  if (state.document.revision !== expectedRevision || state.selection.activeId !== expectedNodeId || store.getProjectEpoch() !== expectedEpoch) return { ok: false, message: "Проект или выбор изменился. Повторите действие." };
  const reason = materialTargetReason(store);
  if (reason) return { ok: false, message: reason };
  const project = state.document.project;
  const node = project.nodes.find(item => item.id === expectedNodeId)!;
  const assigned = project.materials.find(item => item.id === node.materialSlots[0]?.materialId);
  if (assigned && matchesPreset(assigned, preset)) return { ok: true, message: "Материал уже назначен." };
  const existing = project.materials.find(item => matchesPreset(item, preset));
  const materialId = existing?.id ?? crypto.randomUUID();
  if (node.materialSlots[0]?.materialId === materialId) return { ok: true, message: "Материал уже назначен." };
  const commands: ProjectCommand[] = [];
  if (!existing) commands.push({ commandId: crypto.randomUUID(), type: "ADD_MATERIAL", targetIds: [materialId], payload: { material: { ...structuredClone(preset.material), id: materialId } } });
  commands.push({ commandId: crypto.randomUUID(), type: "SET_MATERIAL_SLOT", targetIds: [expectedNodeId, materialId], payload: { nodeId: expectedNodeId, slotName: node.materialSlots[0]?.name ?? "Основной", materialId } });
  const result = store.executeTransaction(commands, expectedRevision, crypto.randomUUID());
  return result.ok ? { ok: true, message: `${preset.name} назначен.` } : { ok: false, message: result.message };
}
