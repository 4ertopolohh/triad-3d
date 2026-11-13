import { expect, it } from "vitest";
import { SphereGeometry, BoxGeometry } from "three";
import { optimizeGeometry } from "../../src/exporters/optimize-geometry";
import type { ExportGeometry } from "../../src/exporters/export-types";
import { compressGeometry } from "../../src/exporters/compress-geometry";
import { unpackGeometries } from "../../src/exporters/packed-geometry";
const fixture=(sphere=true):ExportGeometry=>{
  const geometry=sphere?new SphereGeometry(1,64,32):new BoxGeometry();
  const result={positions:Array.from(geometry.getAttribute("position").array),normals:Array.from(geometry.getAttribute("normal").array),uv:Array.from(geometry.getAttribute("uv").array),indices:Array.from(geometry.index!.array),groups:geometry.groups.map(g=>({...g}))};geometry.dispose();return result;
};
it("reduces a dense sphere deterministically without mutating source or dropping attributes",async()=>{
  const source=fixture(),before=structuredClone(source);
  const result=await optimizeGeometry(source,{ratio:.5,error:.01});
  expect(source).toEqual(before);expect(result.geometry.indices!.length).toBeLessThan(source.indices!.length);
  expect(result.geometry.normals!.length).toBe(result.geometry.positions.length);expect(result.geometry.uv!.length).toBe(result.geometry.positions.length/3*2);
  expect(JSON.stringify(result.geometry).length).toBeLessThan(JSON.stringify(source).length);
  expect(result).toEqual(await optimizeGeometry(source,{ratio:.5,error:.01}));
  // Original retained samples remain on the unit sphere; no generated off-surface vertices.
  for(let i=0;i<result.geometry.positions.length;i+=3)expect(Math.hypot(...result.geometry.positions.slice(i,i+3))).toBeCloseTo(1,5);
});
it("keeps cube material boundaries and color seams",async()=>{
  const source=fixture(false);source.colors=source.normals!.map(n=>(n+1)/2);
  const {geometry}=await optimizeGeometry(source,{ratio:.1,error:.05});
  expect(geometry.groups.map(g=>g.materialIndex)).toEqual(source.groups.map(g=>g.materialIndex));
  expect(geometry.groups.every(g=>g.count===6)).toBe(true);expect(geometry.colors!.length).toBe(geometry.positions.length);
  expect(geometry.uv).toBeDefined();
});
it("rejects unsafe settings, invalid indices and overlapping material groups",async()=>{
  await expect(optimizeGeometry(fixture(),{ratio:0,error:.01})).rejects.toThrow();
  const invalid=fixture();invalid.indices![0]=-1;await expect(optimizeGeometry(invalid,{ratio:.5,error:.01})).rejects.toThrow("индексы");
  const overlap=fixture(false);overlap.groups[1]!.start=0;await expect(optimizeGeometry(overlap,{ratio:.5,error:.01})).rejects.toThrow("Группы");
});
it("preserves valid empty Boolean results",async()=>{
  const empty={positions:[],indices:[],normals:[],groups:[]};
  expect((await optimizeGeometry(empty,{ratio:.5,error:.01})).geometry).toEqual(empty);
});
it("decodes index streams above 1.5M independently of vertex count",async()=>{
  const geometry:ExportGeometry={positions:[0,0,0,1,0,0,0,1,0],indices:Array.from({length:1_500_003},(_,i)=>i%3),groups:[]};
  const decoded=await unpackGeometries({mesh:await compressGeometry(geometry)});
  expect(decoded.mesh!.indices!.length).toBe(1_500_003);
  expect(decoded.mesh!.indices!.every((value,i)=>value===i%3)).toBe(true);
});
