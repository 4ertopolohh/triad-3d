import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import hdrUrl from "../../src/spikes/renderer/assets/studio_small_03_1k.hdr?url";
import modelUrl from "./materials.glb?url";

const run=document.querySelector("#run"),cancel=document.querySelector("#cancel"),result=document.querySelector("#result");
let cleanup=()=>{},controller=null,frame=0,generation=0;
cancel.onclick=()=>{controller?.abort();};
window.addEventListener("pagehide",()=>{generation++;controller?.abort();cancelAnimationFrame(frame);cleanup();});
run.onclick=async()=>{
  cleanup();const token=++generation;controller=new AbortController();const signal=controller.signal;run.disabled=true;cancel.disabled=false;result.textContent="Подготовка сцены…";
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,4/3,.1,100);camera.position.set(4,3,7);camera.lookAt(0,0,0);
  let raster,tracerRenderer,tracer,env;let started=0;
  const stopTracer=()=>{tracer?.dispose();tracer=undefined;tracerRenderer?.dispose();tracerRenderer?.forceContextLoss();tracerRenderer=undefined;};
  const report=(status,extra={})=>{if(token!==generation)return;result.textContent=JSON.stringify({status,samples:tracer?.samples??0,isCompiling:tracer?.isCompiling??false,elapsedMs:started?Math.round(performance.now()-started):0,resolution:"400×300",three:T.REVISION,pathtracer:"0.0.27",backend:"WebGL2",...extra},null,2);run.disabled=false;cancel.disabled=true;};
  const dispose=()=>{cancelAnimationFrame(frame);tracer?.dispose();tracer=undefined;for(const renderer of [raster,tracerRenderer]){renderer?.dispose();renderer?.forceContextLoss();}raster=undefined;tracerRenderer=undefined;const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.image?.close?.();t.dispose();});env?.dispose();env=undefined;scene.clear();};cleanup=dispose;
  try{
    const [modelResponse,envResponse]=await Promise.all([fetch(modelUrl,{signal}),fetch(hdrUrl,{signal})]);if(!modelResponse.ok||!envResponse.ok)throw new Error("Fixture fetch failed");
    const gltf=await new GLTFLoader().parseAsync(await modelResponse.arrayBuffer(),"");scene.add(gltf.scene);signal.throwIfAborted();
    const hdr=new HDRLoader().parse(await envResponse.arrayBuffer());env=new T.DataTexture(hdr.data,hdr.width,hdr.height,T.RGBAFormat,hdr.type);env.mapping=T.EquirectangularReflectionMapping;env.colorSpace=T.LinearSRGBColorSpace;env.needsUpdate=true;scene.environment=env;scene.background=new T.Color("#737373");
    scene.add(new T.DirectionalLight(0xffffff,3));
    const floor=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:0x888888,roughness:.85}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.05;scene.add(floor);scene.updateMatrixWorld(true);
    const create=(id)=>{const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(400,300);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;document.querySelector(id).replaceChildren(renderer.domElement);return renderer;};
    raster=create("#raster");raster.render(scene,camera);signal.throwIfAborted();tracerRenderer=create("#trace");
    started=performance.now();tracer=new WebGLPathTracer(tracerRenderer);tracer.renderDelay=0;tracer.fadeDuration=0;tracer.minSamples=1;tracer.tiles.set(2,2);tracer.setScene(scene,camera);
    const step=()=>{if(signal.aborted){report("CANCELLED",{fallback:"Raster remains available"});stopTracer();return;}try{tracer.renderSample();if(tracer.samples>=32){report("PASS",{fallback:"Raster remains available"});return;}if(performance.now()-started>60000){report("TIME_BUDGET",{fallback:"Raster remains available"});stopTracer();return;}result.textContent=`Samples: ${tracer.samples.toFixed(2)} / 32`;frame=requestAnimationFrame(step);}catch(error){report("FALLBACK",{error:String(error)});stopTracer();}};frame=requestAnimationFrame(step);
  }catch(error){report(signal.aborted?"CANCELLED":"FALLBACK",{error:String(error)});if(signal.aborted)dispose();else stopTracer();}
};
