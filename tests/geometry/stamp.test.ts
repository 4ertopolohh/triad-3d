import { createStampGolden } from "../fixtures/stamp-project";
import { createNativeProjectArchive } from "../../src/assets/native-project-archive";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { writeFile } from "node:fs/promises";
import { derivedGeometry } from "../../src/geometry/derived-geometry";
import { expect, it, vi } from "vitest";
import { parseStampParameters, stampMeshes, stampPlacements, type StampParameters } from "../../src/geometry/modifiers/stamp";
import { compute, manifoldModule } from "../../src/geometry/csg/core";
import { ModifierEvaluator } from "../../src/geometry/modifiers";
import type { CsgRequest, CsgResult, MeshData } from "../../src/geometry/csg";
import { SphereGeometry, BoxGeometry } from "three";
import { fromThree } from "../../src/geometry/csg";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { createEditorStore } from "../../src/app/editor-store";
import { applyStampChange } from "../../src/app/stamp-actions";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";

const params: StampParameters = { shape: "hole", center: [.2,.5,0], normal: [0,1,0], radius: .12, depth: 1.2, count: 1, spread: 0, seed: 42, mirror: "x" };
function fixture(){const project=createProject();const root=project.nodes[0]!;root.children.push("cube");project.nodes.push(createPrimitiveNode("cube",root.id,"cube"));return project;}
const factory=()=>new ModifierEvaluator({csg:{cancel(){},async run(request:CsgRequest):Promise<CsgResult>{const result=await compute(request.operation,request.target.mesh,request.cutter.mesh);return {...result,jobId:request.jobId,coordinateSpace:"target-local",stats:{inputTriangles:result.inputTriangles,outputTriangles:result.outputTriangles,computeMs:result.computeMs},warnings:[]};}}});
async function volume(mesh:MeshData){const api=await manifoldModule();const source=new api.Mesh({numProp:3,vertProperties:mesh.positions.slice(),triVerts:mesh.indices.slice()});source.merge();const solid=new api.Manifold(source);try{return solid.volume();}finally{solid.delete();}}

it("generates deterministic seeded tangent repeats and reflected normals",async()=>{
  const repeat={...params,count:5,spread:1};
  expect(stampPlacements(repeat)).toEqual(stampPlacements(repeat));
  expect(stampPlacements({...repeat,seed:43})).not.toEqual(stampPlacements(repeat));
  const placements=stampPlacements(params);expect(placements).toHaveLength(2);expect(placements[1]!.center[0]).toBe(-.2);
  const meshes=await stampMeshes(params);expect(meshes).toHaveLength(2);
  expect(()=>parseStampParameters({...params,count:10000})).toThrow();expect(()=>parseStampParameters({...params,normal:[0,0,0]})).toThrow();expect(()=>parseStampParameters({...params,code:"eval"})).toThrow();
});
it("cuts mirrored holes and fuses spikes with real Manifold while retaining editable parameters",async()=>{
  for(const shape of ["hole","dent","spike"] as const){
    const store=createEditorStore(fixture()),before=store.captureDocument().project;
    const result=await applyStampChange(store,{type:"add",targetId:"cube",parameters:{...params,shape,depth:shape==="hole"?1.2:.3}},factory);expect(result.ok).toBe(true);
    const project=store.captureDocument().project,evaluator=factory();
    try{const output=await evaluator.evaluate(project,"cube");expect(output.ok).toBe(true);if(output.ok){const amount=await volume(output.mesh);
      if(shape==="hole"){const geometry=derivedGeometry(output.mesh);try{const positions=geometry.getAttribute("position"),normals=geometry.getAttribute("normal");let panels=0;for(let i=0;i<positions.count;i+=3)if([0,1,2].every(j=>Math.abs(positions.getY(i+j)-.5)<1e-5)){panels++;for(let j=0;j<3;j++)expect(normals.getY(i+j)).toBeGreaterThan(.999);}expect(panels).toBeGreaterThan(0);}finally{geometry.dispose();}}
expect(amount).toBeGreaterThan(.5);if(shape==="spike")expect(amount).toBeGreaterThan(1);else expect(amount).toBeLessThan(.99);}}
    finally{evaluator.dispose();}
    const serialized=serializeProjectDocument(project);expect(serialized.ok).toBe(true);if(serialized.ok)expect(deserializeProjectDocument(serialized.value)).toMatchObject({ok:true,value:{modifiers:[{kind:"stamp",parameters:{shape,seed:42,mirror:"x"}}]}});
    expect(store.undo(1).ok).toBe(true);expect(store.captureDocument().project).toEqual(before);expect(store.redo(2).ok).toBe(true);
  }
});
it("rolls back complete removal and rejects stale cancellation without publishing geometry",async()=>{
  const store=createEditorStore(fixture()),before=store.captureDocument().project;
  const result=await applyStampChange(store,{type:"add",targetId:"cube",parameters:{...params,shape:"dent",center:[0,0,0],radius:10,depth:10}},factory);
  expect(result.ok).toBe(false);expect(store.captureDocument().project).toEqual(before);expect(store.getSnapshot().history.entries).toHaveLength(0);
  const evaluator=factory(),abort=new AbortController();abort.abort();try{expect(await evaluator.evaluate(before,"cube",abort.signal)).toMatchObject({ok:false,error:{code:"JOB_CANCELLED"}});}finally{evaluator.dispose();}
});

it("projects repeat spikes onto a curved surface and rejects misses",async()=>{
  const geometry=new SphereGeometry(2,32,16);
  try{const mesh=fromThree(geometry),spikes=await stampMeshes({...params,shape:"spike",center:[0,2,0],normal:[0,1,0],depth:.3,count:6,spread:1,mirror:"off"},mesh);expect(spikes).toHaveLength(6);for(const spike of spikes){const distances=[];for(let i=0;i<spike.positions.length;i+=3)distances.push(Math.hypot(spike.positions[i]!,spike.positions[i+1]!,spike.positions[i+2]!));expect(Math.min(...distances)).toBeLessThan(2);expect(Math.max(...distances)).toBeGreaterThan(2.2);}await expect(stampMeshes({...params,center:[20,2,0]},mesh)).rejects.toThrow("не попало");}finally{geometry.dispose();}
});
it("checks transitive dependents even when removing the last stamp and rejects mismatched ownership",async()=>{
  const project=fixture(),root=project.nodes[0]!;root.children.push("consumer");const consumer=createPrimitiveNode("cube",root.id,"consumer");consumer.modifierIds.push("boolean");project.nodes.push(consumer);project.modifiers.push({id:"boolean",nodeId:"consumer",kind:"boolean",order:0,enabled:true,version:0,parameters:{operation:"subtract",cutterNodeId:"cube"}});
  project.nodes.find(n=>n.id==="cube")!.modifierIds.push("stamp");project.modifiers.push({id:"stamp",nodeId:"cube",kind:"stamp",order:0,enabled:true,version:0,parameters:params});
  const store=createEditorStore(project),before=store.captureDocument().project,visited:string[]=[];
  const evaluator=factory(),original=evaluator.evaluate.bind(evaluator);
  vi.spyOn(evaluator,"evaluate").mockImplementation(async(p,id,signal)=>{visited.push(id);return id==="consumer"?{ok:false,error:{code:"GEOMETRY_NON_MANIFOLD",message:"Dependent failure"},warnings:[],appliedModifierIds:[],fallback:false}:original(p,id,signal);});
  expect((await applyStampChange(store,{type:"remove",targetId:"cube",modifierId:"stamp"},()=>evaluator)).ok).toBe(false);expect(visited).toEqual(["cube","consumer"]);expect(store.captureDocument().project).toEqual(before);
  expect((await applyStampChange(store,{type:"remove",targetId:"consumer",modifierId:"stamp"},factory)).ok).toBe(false);expect(store.getSnapshot().history.entries).toHaveLength(0);
});
it("cancels a pending stamp job without committing a late result",async()=>{
  const store=createEditorStore(fixture()),before=store.captureDocument().project,evaluator=factory();
  let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});
  const original=evaluator.evaluate.bind(evaluator);vi.spyOn(evaluator,"evaluate").mockImplementation(async(p,id,signal)=>{await gate;return original(p,id,signal);});
  const pending=applyStampChange(store,{type:"add",targetId:"cube",parameters:params},()=>evaluator);await Promise.resolve();expect(store.jobs.cancelJob()).toBe(true);finish();expect(await pending).toMatchObject({ok:false,status:"cancelled"});expect(store.captureDocument().project).toEqual(before);expect(store.getSnapshot().history.entries).toHaveLength(0);
});

it("updates parameters and reorders editable generators",async()=>{
  const store=createEditorStore(fixture());expect((await applyStampChange(store,{type:"add",targetId:"cube",parameters:params},factory)).ok).toBe(true);
  const first=store.captureDocument().project.modifiers[0]!.id;
  expect((await applyStampChange(store,{type:"update",targetId:"cube",modifierId:first,parameters:{...params,radius:.1}},factory)).ok).toBe(true);
  expect((await applyStampChange(store,{type:"add",targetId:"cube",parameters:{...params,shape:"spike",center:[0,-.5,0],normal:[0,-1,0],depth:.3,mirror:"off"}},factory)).ok).toBe(true);
  const second=store.captureDocument().project.modifiers[1]!.id;
  expect((await applyStampChange(store,{type:"move",targetId:"cube",modifierId:second,toIndex:0},factory)).ok).toBe(true);
  const saved=store.captureDocument().project;expect(saved.nodes.find(n=>n.id==="cube")!.modifierIds).toEqual([second,first]);expect(saved.modifiers.find(m=>m.id===first)!.parameters.radius).toBe(.1);
});

it("keeps a sampled surface under an overhang instead of jumping to the outermost hit",async()=>{
  const geometry=new BoxGeometry(1,1,1);try{const base=fromThree(geometry),positions=new Float32Array(base.positions.length*2);positions.set(base.positions);positions.set(base.positions,base.positions.length);for(let i=base.positions.length+1;i<positions.length;i+=3)positions[i]=positions[i]!+3;const indices=new Uint32Array(base.indices.length*2);indices.set(base.indices);indices.set(base.indices.map(i=>i+base.positions.length/3),base.indices.length);const [spike]=await stampMeshes({...params,shape:"spike",center:[0,.5,0],normal:[0,1,0],depth:.3,mirror:"off"},{positions,indices});const ys=Array.from(spike!.positions).filter((_n,i)=>i%3===1);expect(Math.max(...ys)).toBeLessThan(1);expect(Math.min(...ys)).toBeLessThan(.5);}finally{geometry.dispose();}
});

it("evaluates the complex golden and optionally emits its editable native archive",async()=>{
 const project=createStampGolden(),evaluator=factory();try{const result=await evaluator.evaluate(project,"mesh-node");expect(result.ok).toBe(true);if(result.ok){expect(result.mesh.indices.length/3).toBeGreaterThan(300);expect(await volume(result.mesh)).toBeGreaterThan(7);expect(await volume(result.mesh)).toBeLessThan(8);}if(process.env.TRIAD_STAMP_GOLDEN){const archive=await createNativeProjectArchive(project,new AssetBytes(),"0.1.0");expect(archive.ok).toBe(true);if(archive.ok)await writeFile(process.env.TRIAD_STAMP_GOLDEN,new Uint8Array(await archive.value.arrayBuffer()));}}finally{evaluator.dispose();}
});

if(process.env.TRIAD_STAMP_PROFILE)it("records bounded large-mesh projection responsiveness",async()=>{
 const geometry=new SphereGeometry(2,160,156);const mesh=fromThree(geometry);geometry.dispose();let ticks=0,maxGapMs=0,last=performance.now();const start=last;const timer=setInterval(()=>{const now=performance.now();maxGapMs=Math.max(maxGapMs,now-last);last=now;ticks++;},1);
 try{const result=await stampMeshes({...params,center:[0,2,0],normal:[0,1,0],count:16,spread:.8,mirror:"x"},mesh);await writeFile(process.env.TRIAD_STAMP_PROFILE!,JSON.stringify({inputTriangles:mesh.indices.length/3,cutters:result.length,elapsedMs:performance.now()-start,timerTicks:ticks,maxTimerGapMs:maxGapMs,node:process.version,platform:process.platform},null,2)+"\n");expect(ticks).toBeGreaterThan(0);}finally{clearInterval(timer);}
});
