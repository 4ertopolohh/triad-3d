import { expect, it } from "vitest";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { validateProject } from "../../src/domain/validate-project";
import { prepareExport } from "../../src/exporters/package";
import { generateProceduralMap } from "../../src/materials/procedural";

it("measures a bounded 100-mesh export and procedural workload without invented performance thresholds", async () => {
  const project=createProject();
  for (let i=0;i<100;i++) {const node=createPrimitiveNode("sphere",project.model.rootNodeId,`sphere-${i}`);node.transform.position=[i%10*3,0,Math.floor(i/10)*3];project.nodes.push(node);project.nodes[0]!.children.push(node.id);}
  const memoryBefore=process.memoryUsage();
  let start=performance.now();expect(validateProject(project)).toEqual([]);const validationMs=performance.now()-start;
  start=performance.now();const exported=await prepareExport(project,()=>undefined,"balanced");const exportMs=performance.now()-start;
  expect(exported.triangles).toBe(96000);
  start=performance.now();const map=generateProceduralMap({kind:"stone",width:512,height:512,seed:1,scale:8,intensity:.8});const proceduralMs=performance.now()-start;
  expect(map.ok).toBe(true);
  if (process.env.TRIAD_QA_DIR) {
    await mkdir(process.env.TRIAD_QA_DIR,{recursive:true});
    await writeFile(join(process.env.TRIAD_QA_DIR,"performance.json"),JSON.stringify({environment:{platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem(),node:process.version},workload:{nodes:project.nodes.length,triangles:exported.triangles,exportBytes:exported.bytes,proceduralSize:[512,512]},validationMs,exportMs,proceduralMs,memoryBefore,memoryAfter:process.memoryUsage(),notes:"Node CPU baseline, not browser/GPU FPS. Memory includes test runtime and no forced GC. One measured run, not a statistical benchmark."},null,2));
  }
},30000);
