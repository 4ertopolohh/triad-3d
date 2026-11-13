import { expect, it } from "vitest";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createEditorStore } from "../../src/app/editor-store";
import { prepareExport } from "../../src/exporters/package";
import { evaluateRuntimePose } from "../../src/exporters/runtime-pose";
import { expandInstances } from "../../src/exporters/instance-project";
import { validateProject } from "../../src/domain/validate-project";

it("exports frozen instance geometry with independent animation speed and paused overrides",async()=>{
  const store=createEditorStore(createMaterialAnimationProject()),transform={position:[2,0,0] as const,rotationQuat:[0,0,0,1] as const,scale:[1,1,1] as const};
  for(let i=0;i<3;i++)expect(store.executeCommand({commandId:`add${i}`,type:"ADD_INSTANCE",targetIds:[`i${i}`],payload:{id:`i${i}`,transform}},i).ok).toBe(true);
  for(const [i,clipId,speed] of [[1,"clip-1",2],[2,null,1]] as const)expect(store.executeCommand({commandId:`override${i}`,type:"SET_INSTANCE",targetIds:[`i${i}`],payload:{id:`i${i}`,transform,visible:true,animationOverride:{clipId,speed}}},store.getSnapshot().document.revision).ok).toBe(true);
  const project=store.captureDocument().project,before=structuredClone(project),expanded=expandInstances(project);
  expect(validateProject(expanded.project)).toEqual([]);
  const exported=await prepareExport(project,()=>undefined,"max",undefined,undefined,[{name:"cubeSize",nodeId:"mesh-node",property:"scale",defaultValue:2}]);
  expect(project).toEqual(before);expect(exported.bundle.project.scene.instances).toEqual([]);expect(exported.bundle.project.modelSnapshots).toBeUndefined();expect(exported.triangles).toBe(36);
  const pose=evaluateRuntimePose(exported.bundle,"clip-1",.5,false);
  expect(pose.get("instance-0:entity:mesh-node")!.position[1]).toBe(.25);
  expect(pose.get("instance-1:entity:mesh-node")!.position[1]).toBe(.5);
  expect(pose.has("instance-2:entity:mesh-node")).toBe(false);
  expect(exported.files.has("src/exporters/runtime-pose.ts")).toBe(true);
  const component=new TextDecoder().decode(exported.files.get("src/TriadModel.tsx"));expect(component.match(/props.cubeSize/g)).toHaveLength(3);
});
