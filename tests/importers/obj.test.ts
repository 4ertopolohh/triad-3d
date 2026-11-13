import { expect, it } from "vitest";
import { parseObj } from "../../src/importers/obj/parse-obj";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { OBJ_LIMITS } from "../../src/importers/obj/limits";
const square="v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n";
it("imports signed indices, UV seams and named groups without fetching MTL",()=>{
  let n=0;const result=parseObj(square+"mtllib https://invalid.example/secret.mtl\ng Панель\nf -4/1 -3/2 -2/3 -1/4\ng Треугольник\nf 1/1 2/2 3/3","root","test",()=>`n${n++}`);
  expect(result.triangles).toBe(3);expect(result.nodes.map(n=>n.name)).toEqual(["Панель","Треугольник"]);
  const source=result.nodes[0]!.meshSource;if(source.kind!=="editable")throw new Error();
  expect(source.uv).toEqual([0,0,1,0,1,1,0,1]);expect(source.indices).toEqual([0,1,2,0,2,3]);
  expect(result.diagnostics.join()).toContain("внешние пути не открываются");
  expect(result.diagnostics.join()).toContain("UV-швах");
});
it("rejects bounded input violations before application",()=>{
  expect(()=>parseObj("#".repeat(OBJ_LIMITS.line+1),"r","bad")).toThrow("длины");
  expect(()=>parseObj(" ".repeat(OBJ_LIMITS.bytes+1),"r","bad")).toThrow("16 МиБ");
  expect(()=>parseObj(square+Array.from({length:129},(_,i)=>`g group${i}\nf 1 2 3`).join("\n"),"r","bad")).toThrow("128 групп");
});
it("rolls back earlier nodes if a later group is invalid, and rejects stale revisions",()=>{
  const store=createEditorStore(createProject()),before=structuredClone(store.captureDocument().project);
  const imported=parseObj(square+"g A\nf 1 2 3\ng B\nf 1 3 4",before.model.rootNodeId,"test");
  const commands=imported.nodes.map(node=>({commandId:crypto.randomUUID(),type:"ADD_NODE" as const,targetIds:[node.parentId!,node.id] as [string,string],payload:{parentId:node.parentId!,node}}));
  commands[1]!.payload.node.id=commands[0]!.payload.node.id;commands[1]!.targetIds[1]=commands[0]!.payload.node.id;
  expect(store.executeTransaction(commands,0).ok).toBe(false);expect(store.captureDocument().project).toEqual(before);expect(store.getSnapshot().history.canUndo).toBe(false);
  expect(store.executeTransaction([commands[0]!],0).ok).toBe(true);const after=structuredClone(store.captureDocument().project);
  expect(store.executeTransaction(commands,0).ok).toBe(false);expect(store.captureDocument().project).toEqual(after);
});
it("honors hard faces and explicit smoothing groups",()=>{
  const faces="f 1 2 3\nf 1 3 4";
  for(const [prefix,vertices] of [["s off\n",6],["s 3\n",4]] as const){const source=parseObj(square+prefix+faces,"root","quad").nodes[0]!.meshSource;if(source.kind!=="editable")throw new Error();expect(source.positions.length/3).toBe(vertices);expect(source.uv).toBeUndefined();}
});
it("preserves normal-index splits while diagnosing authored normal recalculation",()=>{
  const source=parseObj(square+"vn 0 0 1\nvn 0 1 0\nf 1//1 2//1 3//1\nf 1//2 3//2 4//2","root","quad");
  const mesh=source.nodes[0]!.meshSource;if(mesh.kind!=="editable")throw new Error();expect(mesh.positions).toHaveLength(18);expect(source.diagnostics.join()).toContain("нормалей пересчитаны");
});
it.each(["f 0 2 3","f 1 2 8","f -9 2 3","f 1/9 2/2 3/3","f 1 1 3","f 1 2 3 4 1","f 1 3 2 4","v NaN 0 0","v 1 2 3 2","curv 0 1 1 2"])("rejects malformed or unsupported input atomically: %s",bad=>{expect(()=>parseObj(square+bad,"root","bad")).toThrow();});
it("rejects nonplanar and concave quads",()=>{
  expect(()=>parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 1\nf 1 2 3 4","r","bad")).toThrow("неплоский");
  expect(()=>parseObj("v 0 0 0\nv 1 0 0\nv .2 .2 0\nv 0 1 0\nf 1 2 3 4","r","bad")).toThrow("невыпуклый");
});
it("commits all groups once, survives archive and supports Undo/Redo",async()=>{
  const store=createEditorStore(createProject()),before=structuredClone(store.captureDocument().project);
  const imported=parseObj(square+"g A\nf 1 2 3\ng B\nf 1 3 4",before.model.rootNodeId,"test");
  const result=store.executeTransaction(imported.nodes.map(node=>({commandId:crypto.randomUUID(),type:"ADD_NODE",targetIds:[node.parentId!,node.id],payload:{parentId:node.parentId!,node}})),0);
  expect(result.ok).toBe(true);expect(store.captureDocument().project.nodes).toHaveLength(3);
  const archive=await createNativeProjectArchive(store.captureDocument().project,new AssetBytes(),"0.1.0");expect(archive.ok).toBe(true);
  if(archive.ok){const reopened=await openNativeProjectArchive(await archive.value.arrayBuffer());expect(reopened.ok).toBe(true);}
  expect(store.undo(store.getSnapshot().document.revision).ok).toBe(true);expect(store.captureDocument().project.nodes).toEqual(before.nodes);expect(store.redo(store.getSnapshot().document.revision).ok).toBe(true);expect(store.captureDocument().project.nodes).toHaveLength(3);
});
