import type { RuntimeBundle } from "./export-types";
import type { StaticSnapshot } from "./static-runtime";
import source from "./static-runtime.tsx?raw";

export function singleFileExport(bundle: RuntimeBundle): {code:string; reason?:never} | {code?:never; reason:string} {
  const project = bundle.project;
  if (project.assets.length || project.animations.length || project.scene.instances.length || project.interactions?.length || project.materials.some(m => m.proceduralMaps || Object.values(m.textureSlots ?? {}).length))
    return {reason:"Копируемый фрагмент поддерживает статическую модель без ресурсов и процедурных карт. Для анимации, взаимодействий, текстур и процедур используйте ZIP с полным runtime."};
  const snapshot: StaticSnapshot = {
    nodes:project.nodes.map(n => ({id:n.id,parentId:n.parentId,visible:n.visible,position:[...n.transform.position],rotation:[...n.transform.rotationQuat],scale:[...n.transform.scale],materials:n.materialSlots.map(s => s.materialId)})),
    geometries:bundle.geometries, materials:project.materials.map(m=>({...m,baseColor:[...m.baseColor],emissive:[...m.emissive]})), lights:project.scene.lights.map(l=>({...l,color:[...l.color],position:[...l.position],target:[...l.target]})),
    camera:{...project.scene.camera,position:[...project.scene.camera.position],target:[...project.scene.camera.target]},
    background:project.scene.background.color.map(c=>c*project.scene.background.intensity),exposure:project.scene.renderSettings?.exposure ?? 1.25,toneMapping:project.scene.renderSettings?.toneMapping ?? "aces",
  };
  const json = JSON.stringify(snapshot).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  const code = `${source}\nconst snapshot: StaticSnapshot = JSON.parse(${JSON.stringify(json)});\nexport default function TriadModel(props: StaticProps) {return <StaticRuntime {...props} data={snapshot} />;}\n`;
  return code.length > 512*1024 ? {reason:"Код превышает 512 KiB: для этой геометрии используйте ZIP."} : {code};
}
