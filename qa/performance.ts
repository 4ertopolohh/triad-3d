import { WebGPURenderer } from "three/webgpu";
import { ThreeRendererAdapter, type BackendMode } from "../src/renderer/adapter";
import { createProject } from "../src/domain/create-project";
import { createPrimitiveNode } from "../src/geometry/primitives";

const host=document.querySelector<HTMLDivElement>("#viewport")!;
const report=document.querySelector<HTMLPreElement>("#report")!;
let adapter:ThreeRendererAdapter|undefined;
let busy=false;
async function run(mode:BackendMode) {
  if(busy)return;busy=true;
  try {
    await adapter?.dispose();
    const project=createProject();project.scene.camera.position=[35,30,40];project.scene.camera.target=[13.5,0,13.5];
    for(let i=0;i<100;i++){const node=createPrimitiveNode("sphere",project.model.rootNodeId,`sphere-${i}`);node.transform.position=[i%10*3,0,Math.floor(i/10)*3];project.nodes.push(node);project.nodes[0]!.children.push(node.id);}
    const cpu:number[]=[],intervals:number[]=[];let frame=0,previous=0,backend="";
    adapter=new ThreeRendererAdapter(status=>{backend=status.backend;if(status.phase!=="ready")report.textContent=status.message;if(status.phase==="error"||status.phase==="lost")busy=false;},()=>{},selected=>{
      const renderer=new WebGPURenderer({antialias:true,forceWebGL:selected==="webgl2"});
      const render=renderer.render.bind(renderer);
      renderer.render=(scene,camera)=>{
        const start=performance.now();render(scene,camera);const elapsed=performance.now()-start;
        frame++;
        if(frame>30&&frame<=150){cpu.push(elapsed);intervals.push(start-previous);}
        previous=start;
        if(frame===150){
          const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.ceil(sorted.length*.95)-1]};};
          report.textContent=JSON.stringify({browser:navigator.userAgent,backend,devicePixelRatio:devicePixelRatio,canvas:[renderer.domElement.width,renderer.domElement.height],frames:cpu.length,cpuSubmissionMs:stats(cpu),frameIntervalMs:stats(intervals),render:renderer.info.render,memory:renderer.info.memory,notes:"Renderer accounting, not total GPU allocation; intervals may include background throttling. Single run."},null,2);
          busy=false;
        }
      };
      return renderer;
    });
    adapter.sync(project,()=>undefined);await adapter.initialize(host,mode);
  } catch(error){report.textContent=String(error);busy=false;}
}
document.querySelector("#gpu")!.addEventListener("click",()=>void run("auto"));
document.querySelector("#gl")!.addEventListener("click",()=>void run("webgl2"));
window.addEventListener("pagehide",()=>void adapter?.dispose());
