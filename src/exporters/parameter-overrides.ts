import type { ExportParameter } from "./export-types";
/** Shared defaults for the export comparison and fixed-frame video capture. */
export function parameterOverrides(parameters:readonly ExportParameter[],nodeIds:Record<string,string[]>={}):Record<string,{scale?:number;color?:string}>{
  const values:Record<string,{scale?:number;color?:string}>=Object.create(null);
  for(const p of parameters)for(const id of nodeIds[p.nodeId]??[p.nodeId]){const value=values[id]??={};if(p.property==="scale")value.scale=Number(p.defaultValue);else value.color=String(p.defaultValue);}
  return values;
}
