import { MeshoptDecoder } from "meshoptimizer/decoder";
import type { ExportGeometry } from "./export-types";
export interface PackedStream { count:number; stride:number; data:string; indices?:boolean }
export interface PackedGeometry { streams:Record<string,PackedStream>; groups:ExportGeometry["groups"]; missingUvSlots?:number[] }
export async function unpackGeometries(input:Record<string,PackedGeometry>):Promise<Record<string,ExportGeometry>>{
  await MeshoptDecoder.ready;
  const output:Record<string,ExportGeometry>=Object.create(null);
  for(const [id,packed] of Object.entries(input)){
    const geometry:ExportGeometry={positions:[],indices:null,groups:packed.groups,...(packed.missingUvSlots?{missingUvSlots:packed.missingUvSlots}:{})};
    for(const [key,stream] of Object.entries(packed.streams)){
      const isIndex=key==="indices",stride=isIndex?4:key==="uv"?8:12;
      if(!["positions","normals","uv","colors","indices"].includes(key)||Boolean(stream.indices)!==isIndex||!Number.isInteger(stream.count)||stream.count<0||stream.count>(isIndex?16_777_216:500_000)||stream.stride!==stride)throw new Error("Некорректный сжатый поток геометрии.");
      const bytes=new Uint8Array(stream.count*stream.stride),encoded=Uint8Array.from(atob(stream.data),c=>c.charCodeAt(0));
      if(stream.count){if(stream.indices)MeshoptDecoder.decodeIndexSequence(bytes,stream.count,4,encoded);else MeshoptDecoder.decodeVertexBuffer(bytes,stream.count,stream.stride,encoded);}
      const values=Array.from(stream.indices?new Uint32Array(bytes.buffer):new Float32Array(bytes.buffer));
      if(key==="indices")geometry.indices=values;else geometry[key as "positions"|"normals"|"uv"|"colors"]=values;
    }
    output[id]=geometry;
  }
  return output;
}
