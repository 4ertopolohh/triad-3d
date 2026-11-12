import { createCommandBus, type ProjectCommand } from "../domain/command-bus";
import type { Project } from "../domain/types";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { EditorStore } from "./editor-store";

export const transformNeedsEvaluation = (store: EditorStore) => !store.isAnimationRecording() && store.getSnapshot().document.project.modifiers.some(m => m.enabled);
export async function checkedTransform(store: EditorStore, commands: ProjectCommand[], revision: number, factory = () => new ModifierEvaluator()): Promise<{ok:true} | {ok:false;message:string}> {
  if (!transformNeedsEvaluation(store)) { const result = store.executeTransaction(commands,revision); return result.ok ? {ok:true} : {ok:false,message:result.message}; }
  if (revision !== store.getSnapshot().document.revision) return {ok:false,message:"Проект изменился до проверки геометрии."};
  const candidate = createCommandBus(structuredClone(store.getSnapshot().document.project) as Project).executeTransaction(commands,0);
  if (!candidate.ok) return {ok:false,message:candidate.message};
  if (!candidate.changed) return {ok:true};
  const evaluator = factory();
  try {
    const outcome = await store.jobs.run({ id:crypto.randomUUID(),name:"Проверка трансформации и геометрии",cancellable:true,
      validate: input => input.revision === revision ? null : {code:"STALE_PROJECT",message:"Проект изменился."},
      compute: async (_input,signal,progress) => {
        const targets = candidate.project.nodes.filter(n => n.kind === "mesh" && n.modifierIds.some(id => candidate.project.modifiers.find(m => m.id === id)?.enabled));
        for (const [i,node] of targets.entries()) {
          const result = await evaluator.evaluate(candidate.project,node.id,signal);
          if (!result.ok) return {ok:false,error:{code:"COMPUTE_FAILED",message:`${node.name}: ${result.error.message}`}};
          progress((i+1)/targets.length);
        }
        return {ok:true,value:commands};
      },commands:value => value,
    });
    return outcome.ok ? {ok:true} : {ok:false,message:outcome.error.message};
  } finally { evaluator.dispose(); }
}
