import { expect, it, vi } from "vitest";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createEditorStore } from "../../src/app/editor-store";
import { checkedTransform } from "../../src/app/checked-transform";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import type { ProjectCommand } from "../../src/domain/command-bus";

it("evaluates a detached geometry candidate before committing and retains history on failure", async () => {
  const project = createMaterialAnimationProject();
  const mesh = project.nodes.find(n => n.id === "mesh-node")!;
  mesh.modifierIds = ["mirror"];
  project.modifiers.push({id:"mirror",nodeId:mesh.id,kind:"mirror",order:0,version:1,enabled:true,parameters:{axes:"x",pivot:[0,0,0],mergeSeam:false}});
  const store = createEditorStore(project);
  const command: ProjectCommand = {commandId:"move",type:"SET_NODE_TRANSFORM",targetIds:[mesh.id],payload:{nodeId:mesh.id,transform:{...mesh.transform,position:[2,0,0]}}};
  const evaluator = new ModifierEvaluator();
  const evaluate = vi.spyOn(evaluator,"evaluate").mockImplementation(async candidate => {
    expect(candidate.nodes.find(n => n.id === mesh.id)!.transform.position).toEqual([2,0,0]);
    expect(store.getSnapshot().document.project.nodes.find(n => n.id === mesh.id)!.transform.position).toEqual([0,0,0]);
    return {ok:false,error:{code:"WORKER_FAILED",message:"kernel failed"},warnings:[],appliedModifierIds:[],fallback:false};
  });
  const before = store.getSnapshot();
  expect((await checkedTransform(store,[command],0,() => evaluator)).ok).toBe(false);
  expect(evaluate).toHaveBeenCalledOnce();
  expect(store.getSnapshot().document).toBe(before.document);
  expect(store.getSnapshot().history).toBe(before.history);
  expect((await checkedTransform(store,[command],0)).ok).toBe(true);
  expect(store.getSnapshot().history.entries).toHaveLength(1);
  expect(store.undo(1).ok).toBe(true);
  expect(store.getSnapshot().document.project.nodes.find(n => n.id === mesh.id)!.transform.position).toEqual([0,0,0]);
});
