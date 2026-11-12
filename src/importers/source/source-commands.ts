import type { ProjectCommand } from "../../domain/command-bus";
import type { SourceImport } from "./parse-source";

export function sourceCommands(result:SourceImport,nextId:()=>string=()=>crypto.randomUUID()):ProjectCommand[]{
  const commands:ProjectCommand[]=[...result.materials.map(material=>({commandId:nextId(),type:"ADD_MATERIAL" as const,targetIds:[material.id] as [string],payload:{material}})),...result.nodes.map(original=>{const node={...original,visible:true};return {commandId:nextId(),type:"ADD_NODE" as const,targetIds:[node.parentId!,node.id] as [string,string],payload:{parentId:node.parentId!,node}};})];
  for(const node of [...result.nodes].reverse())if(!node.visible)commands.push({commandId:nextId(),type:"SET_NODE_FLAGS",targetIds:[node.id],payload:{nodeId:node.id,visible:false}});
  return commands;
}
