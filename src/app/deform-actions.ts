import { createCommandBus, type ProjectCommand } from "../domain/command-bus";
import type { Project } from "../domain/types";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { BendParameters, TaperParameters, TwistParameters, BevelParameters } from "../geometry/modifiers/types";
import type { EditorStore } from "./editor-store";
import { isJobActive, type JobOutcome } from "./job-controller";

export type DeformKind = "bend" | "twist" | "taper" | "bevel";
export type DeformChange =
  | { type: "add"; targetId: string; kind: "bend"; parameters: BendParameters }
  | { type: "add"; targetId: string; kind: "twist"; parameters: TwistParameters }
  | { type: "add"; targetId: string; kind: "taper"; parameters: TaperParameters }
  | { type: "add"; targetId: string; kind: "bevel"; parameters: BevelParameters }
  | { type: "update"; targetId: string; modifierId: string; parameters: BendParameters | TwistParameters | TaperParameters | BevelParameters }
  | { type: "enable"; targetId: string; modifierId: string; enabled: boolean }
  | { type: "move"; targetId: string; modifierId: string; toIndex: number }
  | { type: "remove"; targetId: string; modifierId: string };

const failure = (id: string, message: string): JobOutcome => ({ ok: false, id, status: "validation_failed", error: { code: "VALIDATION_FAILED", message } });

export async function applyDeformChange(store: EditorStore, change: DeformChange,
  evaluatorFactory: () => ModifierEvaluator = () => new ModifierEvaluator()): Promise<JobOutcome> {
  const snapshot = store.getSnapshot();
  const epoch = store.getProjectEpoch();
  const project = snapshot.document.project;
  const target = project.nodes.find(node => node.id === change.targetId);
  const id = crypto.randomUUID();
  if (isJobActive(snapshot.job.status)) return failure(id, "Дождитесь завершения операции.");
  if (snapshot.tool.mode !== "model" || snapshot.meshEdit.mode !== "object" || snapshot.selection.ids.length !== 1
    || snapshot.selection.activeId !== change.targetId) return failure(id, "Выберите один mesh в режиме «Модель».");
  if (!target || target.kind !== "mesh") return failure(id, "Выберите один mesh.");
  if (target.meshSource.kind === "asset") return failure(id, "Деформации импортированного GLB пока недоступны: нет resolver геометрии.");
  if (change.type !== "add" && (!target.modifierIds.includes(change.modifierId)
    || !["bend", "twist", "taper", "bevel"].includes(project.modifiers.find(item => item.id === change.modifierId)?.kind ?? "")))
    return failure(id, "Деформация не принадлежит выбранному mesh.");
  const commandId = crypto.randomUUID();
  let command: ProjectCommand;
  if (change.type === "add") {
    const modifierId = crypto.randomUUID();
    if (change.kind === "bend") command = { commandId, type: "ADD_DEFORM_MODIFIER", targetIds: [target.id, modifierId], payload: { nodeId: target.id, modifierId, kind: "bend", parameters: change.parameters } };
    else if (change.kind === "twist") command = { commandId, type: "ADD_DEFORM_MODIFIER", targetIds: [target.id, modifierId], payload: { nodeId: target.id, modifierId, kind: "twist", parameters: change.parameters } };
    else if (change.kind === "taper") command = { commandId, type: "ADD_DEFORM_MODIFIER", targetIds: [target.id, modifierId], payload: { nodeId: target.id, modifierId, kind: "taper", parameters: change.parameters } };
    else command = { commandId, type: "ADD_DEFORM_MODIFIER", targetIds: [target.id, modifierId], payload: { nodeId: target.id, modifierId, kind: "bevel", parameters: change.parameters } };
  } else if (change.type === "update") command = { commandId, type: "UPDATE_DEFORM_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, parameters: change.parameters } };
  else if (change.type === "enable") command = { commandId, type: "SET_MODIFIER_ENABLED", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, enabled: change.enabled } };
  else if (change.type === "move") command = { commandId, type: "MOVE_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, toIndex: change.toIndex } };
  else command = { commandId, type: "REMOVE_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId } };
  const commands = [command];
  let candidate: Project;
  try {
    const bus = createCommandBus(structuredClone(project) as Project);
    const prepared = bus.executeTransaction(commands, bus.getRevision(), id);
    if (!prepared.ok) return failure(id, `${prepared.code}: ${prepared.message}${prepared.issues?.[0] ? ` ${prepared.issues[0].message}` : ""}`);
    if (!prepared.changed) return { ok: true, id, status: "succeeded", committed: false };
    candidate = prepared.project;
  } catch (error) { return failure(id, error instanceof Error ? error.message : "Не удалось проверить деформацию."); }
  const current = () => {
    const state = store.getSnapshot();
    return store.getProjectEpoch() === epoch && state.document.revision === snapshot.document.revision
      && state.document.project.id === project.id && state.selection.ids.length === 1
      && state.selection.activeId === target.id && state.tool.mode === "model" && state.meshEdit.mode === "object";
  };
  const candidateTarget = candidate.nodes.find(node => node.id === target.id);
  if (candidateTarget?.kind === "mesh" && !candidateTarget.modifierIds.some(modifierId => candidate.modifiers.find(item => item.id === modifierId)?.enabled)) {
    if (!current()) return failure(id, "Проект или выделение изменились до применения.");
    const committed = store.executeTransaction(commands, snapshot.document.revision, id);
    return committed.ok ? { ok: true, id, status: "succeeded", committed: committed.changed } : failure(id, committed.message);
  }
  const evaluator = evaluatorFactory();
  try {
    return await store.jobs.run({ id, name: "Проверка деформации", cancellable: true,
      validate: () => current() ? null : { code: "STALE_PROJECT", message: "Проект или выделение изменились до вычисления." },
      compute: async (_input, signal) => {
        const result = await evaluator.evaluate(candidate, target.id, signal);
        return result.ok ? { ok: true as const, value: commands }
          : { ok: false as const, error: { code: "COMPUTE_FAILED" as const, message: `${result.error.code}: ${result.error.message}` } };
      }, commands: value => current() ? value : [],
    });
  } finally { evaluator.dispose(); }
}
