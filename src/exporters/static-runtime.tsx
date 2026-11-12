import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { WebGPURenderer } from "three/webgpu";

export interface StaticSnapshot {
  nodes: {id:string; parentId:string|null; visible:boolean; position:number[]; rotation:number[]; scale:number[]; materials:string[]}[];
  geometries: Record<string,{positions:number[]; indices:number[]|null; normals?:number[]; colors?:number[]; groups:{start:number;count:number;materialIndex?:number|undefined}[]}>;
  materials: {id:string; baseColor:number[]; metalness:number; roughness:number; emissive:number[]; opacity:number; transmission:number; ior:number; clearcoat:number; envIntensity:number}[];
  lights: {kind:string; color:number[]; intensity:number; position:number[]; target:number[]}[];
  camera: {position:number[];target:number[];fovDegrees:number;near:number;far:number};
  background:number[]; exposure:number; toneMapping:string;
}
export interface StaticProps {width?:number|string; height?:number|string; scale?:number; color?:string}

/** Small asset-free static component; all rendering state is scoped to its mount. */
export function StaticRuntime({data,width="100%",height=480,scale=1,color}: StaticProps & {data:StaticSnapshot}) {
  const host = useRef<HTMLDivElement>(null), controls = useRef({scale,color});
  controls.current = {scale,color};
  const [error,setError] = useState("");
  useEffect(() => {
    const mount = host.current; if (!mount) return;
    let disposed = false;
    const renderer = new WebGPURenderer({forceWebGL:true,antialias:true});
    const scene = new T.Scene(), root = new T.Group(); scene.add(root);
    scene.background = new T.Color().fromArray(data.background);
    renderer.toneMappingExposure = data.exposure;
    renderer.toneMapping = data.toneMapping === "none" ? T.NoToneMapping : data.toneMapping === "neutral" ? T.NeutralToneMapping : T.ACESFilmicToneMapping;
    const camera = new T.PerspectiveCamera(data.camera.fovDegrees,1,data.camera.near,data.camera.far);
    camera.position.fromArray(data.camera.position); camera.lookAt(new T.Vector3().fromArray(data.camera.target));
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.MeshPhysicalMaterial>();
    const originalColors = new Map<T.MeshPhysicalMaterial,T.Color>();
    const objects = new Map<string,T.Object3D>();
    for (const node of data.nodes) {
      const group = new T.Group(); objects.set(node.id,group); group.visible=node.visible;
      group.position.fromArray(node.position); group.quaternion.fromArray(node.rotation).normalize(); group.scale.fromArray(node.scale);
      const source = Object.hasOwn(data.geometries,node.id) ? data.geometries[node.id] : undefined;
      if (!source) continue;
      const geometry = new T.BufferGeometry(); geometries.add(geometry);
      geometry.setAttribute("position",new T.Float32BufferAttribute(source.positions,3));
      if (source.indices) geometry.setIndex(source.indices);
      if (source.normals) geometry.setAttribute("normal",new T.Float32BufferAttribute(source.normals,3)); else geometry.computeVertexNormals();
      if (source.colors) geometry.setAttribute("color",new T.Float32BufferAttribute(source.colors,3));
      source.groups.forEach(g => geometry.addGroup(g.start,g.count,g.materialIndex));
      const create = (id?:string) => {
        const m = data.materials.find(m => m.id === id);
        const material = new T.MeshPhysicalMaterial(m ? {color:new T.Color().fromArray(m.baseColor),emissive:new T.Color().fromArray(m.emissive),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity,transmission:m.transmission,ior:m.ior,clearcoat:m.clearcoat,envMapIntensity:m.envIntensity,transparent:m.transmission===0 && m.opacity<1} : {color:0xaaaaaa,roughness:.65});
        material.vertexColors=!!source.colors; materials.add(material);originalColors.set(material,material.color.clone());return material;
      };
      const list = node.materials.length ? node.materials.map(create) : [create()];
      group.add(new T.Mesh(geometry,list.length>1 && geometry.groups.length ? list : list[0]));
    }
    for (const node of data.nodes) (node.parentId ? objects.get(node.parentId)! : root).add(objects.get(node.id)!);
    for (const light of data.lights) {
      const color = new T.Color().fromArray(light.color);
      const object = light.kind === "ambient" ? new T.AmbientLight(color,light.intensity) : light.kind === "directional" ? new T.DirectionalLight(color,light.intensity) : light.kind === "spot" ? new T.SpotLight(color,light.intensity) : new T.PointLight(color,light.intensity);
      object.position.fromArray(light.position); scene.add(object);
      if (object instanceof T.DirectionalLight || object instanceof T.SpotLight) {object.target.position.fromArray(light.target);scene.add(object.target);}
    }
    const resize = () => {if (disposed) return;const box=mount.getBoundingClientRect(),w=Math.max(1,box.width),h=Math.max(1,box.height);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
    const observer = new ResizeObserver(resize);observer.observe(mount);
    void renderer.init().then(() => {
      if (disposed) {void renderer.dispose();return;}
      mount.appendChild(renderer.domElement);resize();setError("");
      renderer.setAnimationLoop(() => {
        const control=controls.current;root.scale.setScalar(Number.isFinite(control.scale)&&control.scale>0?control.scale:1);
        for (const [material,original] of originalColors) {if (control.color && /^#[0-9a-f]{6}$/i.test(control.color)) material.color.set(control.color);else material.color.copy(original);}
        renderer.render(scene,camera);
      });
    }).catch(e => {if (!disposed) setError(e instanceof Error?e.message:String(e));});
    return () => {disposed=true;observer.disconnect();renderer.setAnimationLoop(null);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.domElement.remove();void renderer.dispose();};
  },[data]);
  return <div style={{width,height}}><div ref={host} style={{width:"100%",height:"100%"}} />{error && <p role="alert">{error}</p>}</div>;
}
