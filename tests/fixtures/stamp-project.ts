import { createMaterialAnimationProject } from "./projects";
import type { StampParameters } from "../../src/geometry/modifiers/stamp";

export function createStampGolden(){
  const project=createMaterialAnimationProject();project.name="Штампы — отверстия и шипы";
  project.animations=[];project.tracks=[];project.keyframes=[];
  const node=project.nodes.find(n=>n.id==="mesh-node")!;if(node.kind!=="mesh")throw new Error("Fixture mesh");
  node.meshSource={kind:"primitive",primitive:"cube",parameters:{size:2}};
  const material=project.materials[0]!;material.metalness=.1;material.roughness=.35;material.baseColor=[.2,.45,.7];
  project.scene.lights.push({id:"key-light",kind:"directional",color:[1,.95,.9],intensity:4,position:[3,5,4],target:[0,0,0]});
  project.scene.camera.position=[3,2.5,4];
  const holes:StampParameters={shape:"hole",center:[0,0,1],normal:[0,0,1],radius:.12,depth:2.2,count:5,spread:.65,seed:92,mirror:"x"};
  const spikes:StampParameters={shape:"spike",center:[0,1,0],normal:[0,1,0],radius:.12,depth:.6,count:6,spread:.65,seed:37,mirror:"off"};
  project.modifiers=[{id:"holes",nodeId:node.id,kind:"stamp",enabled:true,order:0,version:0,parameters:holes},{id:"spikes",nodeId:node.id,kind:"stamp",enabled:true,order:1,version:0,parameters:spikes}];node.modifierIds=["holes","spikes"];
  return project;
}
