import { expect,it } from "vitest";
import { InteractionMixer,interactionError,interactionConflicts,mixLayers } from "../../src/animation/interactions";
import { evaluateClip } from "../../src/animation/timeline";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createEditorStore } from "../../src/app/editor-store";
import { serializeProjectDocument,deserializeProjectDocument } from "../../src/domain/project-serialization";
import type { InteractionRule,Transform } from "../../src/domain/types";
const base:Transform={position:[0,0,0],rotationQuat:[0,0,0,1],scale:[1,1,1]};
const rule:InteractionRule={id:"magnet",nodeId:"mesh-node",name:"Магнит",enabled:true,priority:0,blend:"additive",weight:1,releaseSeconds:.1,event:"proximity",condition:{kind:"always"},action:{kind:"magnet",radius:4,strength:1,frequency:1}};
it("mixes channels and resolves priorities deterministically without mutation",()=>{
  const before=structuredClone(base),pose=mixLayers(base,[{id:"low",priority:0,blend:"additive",weight:1,position:[10,0,0]},{id:"high",priority:1,blend:"override",weight:.5,position:[2,0,0]},{id:"spin",priority:2,blend:"additive",weight:1,rotationQuat:[0,1,0,0]}]);
  expect(pose.position).toEqual([6,0,0]);expect(pose.rotationQuat).toEqual([0,1,0,0]);expect(base).toEqual(before);
  expect(interactionConflicts([{...rule,blend:"override"},{...rule,id:"other",blend:"override"}])).toHaveLength(1);
});
it("releases a magnet smoothly without resetting the base spin phase",()=>{
  const project=createMaterialAnimationProject();project.tracks[0]!.property="transform.rotationQuat";project.keyframes[0]!.value=[0,0,0,1];project.keyframes[1]!.value=[0,1,0,0];
  const mixer=new InteractionMixer();let displaced=base;
  for(let i=0;i<60;i++){const pose=evaluateClip(project,"clip-1",i/60,false).get("mesh-node")!;displaced=mixer.evaluate(pose,[rule],{time:i/60,deltaSeconds:1/60,pointer:[2,0,0],hovered:false,clicked:false});expect(displaced.rotationQuat).toEqual(pose.rotationQuat);}
  expect(displaced.position[0]).toBeGreaterThan(.49);
  let last=displaced.position[0];for(let i=60;i<120;i++){const pose=evaluateClip(project,"clip-1",i/60,false).get("mesh-node")!;const next=mixer.evaluate(pose,[rule],{time:i/60,deltaSeconds:1/60,pointer:null,hovered:false,clicked:false});expect(next.position[0]).toBeLessThan(last);expect(next.rotationQuat).toEqual(pose.rotationQuat);last=next.position[0];}expect(last).toBeLessThan(.0001);
});
it("toggles only on matching clicks and disables effects without editing base transforms",()=>{
  const mixer=new InteractionMixer(),toggle={...rule,event:"click"as const,action:{...rule.action,kind:"click-toggle"as const,strength:2}};
  const input={time:0,deltaSeconds:.25,pointer:null,hovered:true,clicked:true};expect(mixer.evaluate(base,[toggle],input).scale[0]).toBeGreaterThan(1.9);
  expect(mixer.evaluate(base,[toggle],{...input,clicked:false}).scale[0]).toBeGreaterThan(1.99);
  expect(mixer.evaluate(base,[{...toggle,enabled:false}],input)).toEqual(base);
});
it("rejects executable predicates, extra fields and reference cycles; commands roundtrip with Undo",()=>{
  expect(interactionError([{...rule,condition:{kind:"eval",source:"alert(1)"}}],new Set(["mesh-node"]))).toBeTruthy();
  expect(interactionError([{...rule,action:{kind:"invoke",ruleId:"magnet"}}],new Set(["mesh-node"]))).toBeTruthy();
  const store=createEditorStore(createMaterialAnimationProject()),before=store.captureDocument().project;
  const result=store.executeCommand({commandId:"rules",type:"SET_INTERACTIONS",targetIds:[before.id],payload:{projectId:before.id,rules:[rule]}},0);expect(result.ok).toBe(true);
  const saved=serializeProjectDocument(store.captureDocument().project);expect(saved.ok).toBe(true);if(saved.ok)expect(deserializeProjectDocument(saved.value)).toMatchObject({ok:true,value:{interactions:[rule]}});
  expect(store.undo(1).ok).toBe(true);expect(store.captureDocument().project).toEqual(before);expect(store.redo(2).ok).toBe(true);
});
