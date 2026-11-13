import { MeshoptEncoder } from "meshoptimizer/encoder";
import type { ExportGeometry } from "./export-types";
import type { PackedGeometry } from "./packed-geometry";
export async function compressGeometry(geometry:ExportGeometry):Promise<PackedGeometry>{
  await MeshoptEncoder.ready;
  const packed:PackedGeometry={streams:Object.create(null),groups:geometry.groups,...(geometry.missingUvSlots?{missingUvSlots:geometry.missingUvSlots}:{})};
  for(const [key,width] of [["positions",3],["normals",3],["uv",2],["colors",3],["indices",1]] as const){
    const source=geometry[key];if(!source)continue;const indices=key==="indices",typed=indices?new Uint32Array(source):new Float32Array(source),count=source.length/width;
    if(!Number.isInteger(count)||count>(indices?16_777_216:500_000))throw new Error("Превышен бюджет сжатой геометрии.");
    const bytes=count?(indices?MeshoptEncoder.encodeIndexSequence(new Uint8Array(typed.buffer),count,4):MeshoptEncoder.encodeVertexBuffer(new Uint8Array(typed.buffer),count,width*4)):new Uint8Array();
    let binary="";for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    packed.streams[key]={count,stride:width*4,data:btoa(binary),...(indices?{indices:true}:{})};
  }
  return packed;
}
