import { createCommandBus, type ProjectCommand } from "../domain/command-bus";
import type { Project } from "../domain/types";
import { ModifierEvaluator } from "../geometry/modifiers";
import type { EditorStore } from "./editor-store";
import type { JobOutcome } from "./job-controller";

/** Validate the changed mesh and all transitive Boolean consumers before the one commit. */
export async function checkedModifierChange(store: EditorStore, targetId: string, commands: ProjectCommand[], name: string,
  evaluatorFactory: () => ModifierEvaluator): Promise<JobOutcome> {
  const snapshot=store.getSnapshot(),project=snapshot.document.project,id=crypto.randomUUID();
  const fail=(message:string):JobOutcome=>({ok:false,id,status:"validation_failed",error:{code:"VALIDATION_FAILED",message}});
  let candidate:Project;
  try{
    const bus=createCommandBus(structuredClone(project) as Project),prepared=bus.executeTransaction(commands,0,id);
    if(!prepared.ok)return fail(`${prepared.message}${prepared.issues?.[0]?` ${prepared.issues[0].message}`:""}`);
    if(!prepared.changed)return {ok:true,id,status:"succeeded",committed:false};
    candidate=prepared.project;
  }catch(error){return fail(error instanceof Error?error.message:String(error));}
  const affected=new Set([targetId]);
  let changed=true;
  while(changed){changed=false;for(const modifier of candidate.modifiers)if(modifier.enabled&&modifier.kind==="boolean"&&typeof modifier.parameters.cutterNodeId==="string"&&affected.has(modifier.parameters.cutterNodeId)&&!affected.has(modifier.nodeId)){affected.add(modifier.nodeId);changed=true;}}
  const evaluator=evaluatorFactory();
  try{
    return await store.jobs.run({id,name,cancellable:true,
      validate:input=>input.revision===snapshot.document.revision&&input.projectId===project.id?null:{code:"STALE_PROJECT",message:"Проект изменился до вычисления."},
      compute:async(_input,signal)=>{
        for(const nodeId of affected){
          signal.throwIfAborted();const result=await evaluator.evaluate(candidate,nodeId,signal);
          if(!result.ok)return {ok:false as const,error:{code:"COMPUTE_FAILED" as const,message:`${nodeId}: ${result.error.code}: ${result.error.message}`}};
        }
        return {ok:true as const,value:commands};
      },commands:value=>value});
  }finally{evaluator.dispose();}
}
