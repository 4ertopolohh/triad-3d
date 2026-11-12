import { expect, it } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { materialPresets } from "../../src/materials/presets";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { prepareExport, createExportZip } from "../../src/exporters/package";
import { addPreset } from "../../src/animation/presets";

it("builds reproducible chrome/glass/stone and animated-ring acceptance artifacts", async () => {
  const bytes = new Uint8Array(await readFile(new URL("../../src/spikes/renderer/assets/studio_small_03_1k.hdr",import.meta.url)));
  const hash = createHash("sha256").update(bytes).digest("hex");
  for (const ring of [false,true]) {
    let sequence=0;const project=createProject(()=>`golden-${++sequence}`);
    project.name=ring ? "QA — кольцо, хром, вращение" : "QA — хром, стекло, камень";
    project.assets.push({id:"studio",hash,path:`assets/${hash}.hdr`,mediaType:"image/vnd.radiance",colorSpace:"linear"});
    project.scene.background.environmentAssetId="studio";
    project.scene.background.environmentIntensity=1;
    project.scene.background.color=[.16,.17,.19];
    project.scene.camera.position=ring ? [3,2,4] : [0,2,9];
    project.scene.camera.target=[0,0,0];
    const kinds=ring ? ["polished-chrome"] : ["polished-chrome","clear-glass","basic-stone"];
    for (const [index,kind] of kinds.entries()) {
      const preset=materialPresets.find(p=>p.id===kind)!;
      const material={...structuredClone(preset.material),id:`material-${index}`};
      if (kind==="basic-stone") material.proceduralMaps={height:{kind:"stone",seed:7,scale:8,intensity:.8,resolution:256,strength:.12},roughness:{kind:"grain",seed:7,scale:8,intensity:.4,resolution:256}};
      project.materials.push(material);
      const node=createPrimitiveNode(ring ? "torus" : "sphere",project.model.rootNodeId,`mesh-${index}`);
      node.name=preset.name;node.transform.position=[ring ? 0 : (index-1)*2.3,0,0];
      node.materialSlots=[{name:"Основной",materialId:material.id}];project.nodes.push(node);project.nodes[0]!.children.push(node.id);
    }
    if (ring) {project.animations.push({id:"spin",name:"Оборот",durationSeconds:2,loop:true,trackIds:[]});let id=0;addPreset(project,project,"spin","mesh-0","spin",1,()=>`00000000-0000-4000-8000-${String(++id).padStart(12,"0")}`);}
    const assets=new AssetBytes([["studio",bytes]]);
    const archive=await createNativeProjectArchive(project,assets,"0.1.0");
    if (!archive.ok) throw new Error(archive.error.message);
    const reopened=await openNativeProjectArchive(archive.value);expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.value.project).toEqual(project);
    const prepared=await prepareExport(project,id=>assets.get(id),"max");
    expect(prepared.triangles).toBeGreaterThan(0);
    const exportedZip=await createExportZip(prepared);
    expect(exportedZip.size).toBeGreaterThan(0);
    if (process.env.TRIAD_QA_DIR) {
      const directory=process.env.TRIAD_QA_DIR;await mkdir(directory,{recursive:true});
      const name=ring ? "ring" : "materials";
      await writeFile(join(directory,`${name}.triad3d`),new Uint8Array(await archive.value.arrayBuffer()));
      await writeFile(join(directory,`${name}-export.zip`),new Uint8Array(await exportedZip.arrayBuffer()));
    }
  }
},30000);
