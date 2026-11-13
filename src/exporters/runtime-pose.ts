import { evaluateClip } from "../animation/timeline";
import type { RuntimeBundle } from "./export-types";
import type { Transform } from "../domain/types";
export function evaluateRuntimePose(bundle:RuntimeBundle,clipId:string|undefined,time:number,loop:boolean):Map<string,Transform>{
  const project=bundle.project;
  if(!bundle.instancePlayback?.length){const clip=project.animations.find(c=>c.id===clipId)??project.animations[0];return clip?evaluateClip(project,clip.id,time,loop):new Map();}
  const pose=new Map<string,Transform>();
  for(const instance of bundle.instancePlayback){const clip=(instance.inherited&&clipId&&Object.hasOwn(instance.clips,clipId)?instance.clips[clipId]:undefined)??instance.defaultClip;if(clip)for(const [id,transform] of evaluateClip(project,clip,time*instance.speed,loop))pose.set(id,transform);}
  return pose;
}
