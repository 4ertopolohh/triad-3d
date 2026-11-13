import { afterEach, expect, it, vi } from "vitest";
import { videoPlan, renderVideoFrames, type VideoOptions } from "../../src/exporters/video-plan";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createNativeProjectArchive } from "../../src/assets/native-project-archive";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { writeFile } from "node:fs/promises";
import { parameterOverrides } from "../../src/exporters/parameter-overrides";
afterEach(()=>vi.useRealTimers());
const options:VideoOptions={width:640,height:360,fps:30,duration:10,format:"webm"};
it("uses the configured scale and color defaults in preview and video",()=>{
  expect(parameterOverrides([{name:"capture",nodeId:"mesh",property:"scale",defaultValue:2},{name:"tint",nodeId:"mesh",property:"color",defaultValue:"#ff0000"}])).toEqual({mesh:{scale:2,color:"#ff0000"}});
});
it("renders exactly ten seconds at fixed 30 FPS regardless of render latency",async()=>{
  vi.useFakeTimers();
  const frames:number[]=[],durations:number[]=[];let progress=0;
  const rendered=renderVideoFrames(options,async(t,d)=>{frames.push(t);durations.push(d);},new AbortController().signal,p=>{progress=p;});
  await vi.runAllTimersAsync();await rendered;
  expect(frames).toHaveLength(300);expect(frames[0]).toBe(0);expect(frames[299]).toBe(299/30);
  expect(durations.every(d=>d===1/30)).toBe(true);expect(progress).toBe(1);
});
it("stops before encoding another frame after cancellation",async()=>{
  const abort=new AbortController();let rendered=0;
  await expect(renderVideoFrames(options,async()=>{rendered++;if(rendered===3)abort.abort();},abort.signal,()=>{})).rejects.toThrow();
  expect(rendered).toBe(3);
});
it("rejects invalid encoding budgets and quantizes duration to complete frames",()=>{
  for(const change of [{width:641},{height:2048},{fps:0},{fps:NaN},{duration:Infinity},{duration:31},{format:"gif"}])expect(()=>videoPlan({...options,...change} as VideoOptions)).toThrow();
  expect(videoPlan({...options,duration:1.01})).toEqual({frames:30,duration:1});
});
if(process.env.TRIAD_VIDEO_GOLDEN)it("writes the animated video acceptance fixture",async()=>{
  const project=createMaterialAnimationProject();project.name="Видео — подъём куба";
  project.materials[0]!.metalness=0;project.materials[0]!.baseColor=[.12,.45,.85];
  project.scene.camera.position=[3,2.5,4];project.scene.camera.target=[0,.5,0];
  project.animations[0]!.loop=true;
  const archive=await createNativeProjectArchive(project,new AssetBytes(),"0.1.0");expect(archive.ok).toBe(true);
  if(archive.ok)await writeFile(process.env.TRIAD_VIDEO_GOLDEN!,new Uint8Array(await archive.value.arrayBuffer()));
});
