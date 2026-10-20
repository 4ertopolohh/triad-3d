import { createCommandBus, type ProjectCommand } from "../domain/command-bus";
import type { Project } from "../domain/types";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { MirrorParameters } from "../geometry/modifiers/types";
import type { EditorStore } from "./editor-store";
import type { JobOutcome } from "./job-controller";

export type MirrorChange =
  | { type: "add"; targetId: string; parameters: MirrorParameters }
  | { type: "update"; targetId: string; modifierId: string; parameters: MirrorParameters }
  | { type: "enable"; targetId: string; modifierId: string; enabled: boolean }
  | { type: "move"; targetId: string; modifierId: string; toIndex: number }
  | { type: "remove"; targetId: string; modifierId: string };

const failure = (id: string, message: string): JobOutcome => ({ ok: false, id, status: "validation_failed", error: { code: "VALIDATION_FAILED", message } });

/** Checks the complete resulting stack on a detached document before committing one history step. */
export async function applyMirrorChange(store: EditorStore, change: MirrorChange,
  evaluatorFactory: () => ModifierEvaluator = () => new ModifierEvaluator()): Promise<JobOutcome> {
  const snapshot = store.getSnapshot();
  const epoch = store.getProjectEpoch();
  const project = snapshot.document.project;
  const target = project.nodes.find(node => node.id === change.targetId);
  const id = crypto.randomUUID();
  if (!target || target.kind !== "mesh") return failure(id, "Выберите один mesh.");
  if (target.meshSource.kind === "asset") return failure(id, "Mirror для импортированного GLB пока недоступен: нет resolver геометрии.");
  if (change.type !== "add" && (!target.modifierIds.includes(change.modifierId)
    || project.modifiers.find(item => item.id === change.modifierId)?.kind !== "mirror"))
    return failure(id, "Mirror не принадлежит выбранному mesh.");
  const commandId = crypto.randomUUID();
  let command: ProjectCommand;
  if (change.type === "add") {
    const modifierId = crypto.randomUUID();
    command = { commandId, type: "ADD_MIRROR_MODIFIER", targetIds: [target.id, modifierId], payload: { nodeId: target.id, modifierId, parameters: change.parameters } };
  } else if (change.type === "update") command = { commandId, type: "UPDATE_MIRROR_MODIFIER", targetIds: [change.modifierId], payload: { modifierId: change.modifierId, parameters: change.parameters } };
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
  } catch (error) { return failure(id, error instanceof Error ? error.message : "Не удалось проверить Mirror."); }
  const candidateTarget = candidate.nodes.find(node => node.id === target.id);
  if (candidateTarget?.kind === "mesh" && !candidateTarget.modifierIds.some(modifierId => candidate.modifiers.find(item => item.id === modifierId)?.enabled)) {
    if (store.getProjectEpoch() !== epoch) return failure(id, "Проект заменён до применения изменения.");
    const committed = store.executeTransaction(commands, snapshot.document.revision, id);
    return committed.ok ? { ok: true, id, status: "succeeded", committed: committed.changed } : failure(id, committed.message);
  }
  const evaluator = evaluatorFactory();
  try {
    return await store.jobs.run({
      id, name: "Проверка зеркалирования", cancellable: true,
      validate: input => store.getProjectEpoch() === epoch && input.revision === snapshot.document.revision && input.projectId === project.id
        ? null : { code: "STALE_PROJECT", message: "Проект изменился до вычисления." },
      compute: async (_input, signal) => {
        const result = await evaluator.evaluate(candidate, target.id, signal);
        return result.ok ? { ok: true as const, value: commands }
          : { ok: false as const, error: { code: "COMPUTE_FAILED" as const, message: `${result.error.code}: ${result.error.message}` } };
      }, commands: value => value,
    });
  } finally { evaluator.dispose(); }
}
