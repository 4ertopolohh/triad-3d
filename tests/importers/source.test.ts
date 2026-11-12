import { expect, it } from "vitest";
import { parseSource } from "../../src/importers/source/parse-source";
import { createProject } from "../../src/domain/create-project";
import { createCommandBus, type ProjectCommand } from "../../src/domain/command-bus";
import { sourceCommands } from "../../src/importers/source/source-commands";

it("imports static hierarchy and PBR as one reversible domain transaction",()=>{
  const project=createProject();let sequence=0;
  const imported=parseSource('export default () => <group name="Деталь" position={[1,2,3]}><mesh scale={2}><boxGeometry args={[2,3,4]}/><meshStandardMaterial color="#ff0000" roughness={0.2}/></mesh></group>',project.model.rootNodeId,()=>`import-${++sequence}`);
  expect(imported.nodes).toHaveLength(2);expect(imported.materials).toHaveLength(1);
  expect(imported.nodes[0]!.transform.position).toEqual([1,2,3]);expect(imported.nodes[1]!.transform.scale).toEqual([2,2,2]);
  expect(imported.materials[0]!.baseColor).toEqual([1,0,0]);
  const commands:ProjectCommand[]=[...imported.materials.map(material=>({commandId:`material-${material.id}`,type:"ADD_MATERIAL" as const,targetIds:[material.id] as [string],payload:{material}})),...imported.nodes.map(node=>({commandId:`node-${node.id}`,type:"ADD_NODE" as const,targetIds:[node.parentId!,node.id] as [string,string],payload:{parentId:node.parentId!,node}}))];
  const bus=createCommandBus(project);const result=bus.executeTransaction(commands,0);expect(result.ok).toBe(true);
  if(result.ok){expect(result.project.nodes[1]!.children).toEqual([imported.nodes[1]!.id]);expect(result.undoPatch.changes.length).toBeGreaterThan(0);}
});

it("never executes calls, imports, handlers, dynamic attributes or conditional content",()=>{
  const source=`import x from "https://example.invalid/evil"; fetch("https://example.invalid");
  const A=()=> <group><mesh position={alert('bad')}><boxGeometry/></mesh><mesh onClick={()=>fetch('bad')}><sphereGeometry/></mesh>{dangerous.map(()=> <mesh><boxGeometry/></mesh>)}</group>`;
  const result=parseSource(source,"root");
  expect(result.nodes).toHaveLength(2);expect(result.diagnostics.filter(d=>d.kind==="unsupported").length).toBeGreaterThanOrEqual(4);
  expect(result.diagnostics.some(d=>d.type==="import")).toBe(true);
  expect(result.diagnostics.every(d=>d.line>=1&&d.column>=1)).toBe(true);
  expect(parseSource('const x = flag ? <mesh><boxGeometry/></mesh> : null',"root").nodes).toHaveLength(0);
  for(const operator of ["&&","||","??"])expect(parseSource(`const x = flag ${operator} <mesh><boxGeometry/></mesh>`,"root").nodes).toHaveLength(0);
});

it("preserves source constructor defaults, fragments and hidden hierarchies",()=>{
  const project=createProject();
  const imported=parseSource('<group visible={false}><><mesh><torusGeometry args={[2]}/></mesh><mesh><cylinderGeometry/></mesh></></group>',project.model.rootNodeId);
  expect(imported.nodes).toHaveLength(3);
  const torus=imported.nodes[1]!,cylinder=imported.nodes[2]!;
  if(torus.kind!=="mesh"||cylinder.kind!=="mesh")throw new Error("Expected meshes");
  expect(torus.meshSource).toMatchObject({parameters:{radius:2,tube:.4,radialSegments:12,tubularSegments:48}});
  expect(cylinder.meshSource).toMatchObject({parameters:{height:1}});
  const outcome=createCommandBus(project).executeTransaction(sourceCommands(imported),0);
  expect(outcome.ok).toBe(true);if(outcome.ok)expect(outcome.project.nodes[1]!.visible).toBe(false);
  expect(()=>parseSource('<mesh><boxGeometry></mesh>',"root")).toThrow("Синтаксическая ошибка");
});

it("rejects unsafe budgets and unsupported geometry without changing siblings",()=>{
  expect(()=>parseSource("x".repeat(262145),"root")).toThrow("256");
  const result=parseSource('<group><mesh><boxGeometry args={[-1,2,3]}/></mesh><mesh><coneGeometry/></mesh><script>danger()</script></group>',"root");
  expect(result.nodes).toHaveLength(2);expect(result.materials).toHaveLength(0);
  expect(result.diagnostics.some(d=>d.type==="script"&&d.kind==="unsupported")).toBe(true);
});
