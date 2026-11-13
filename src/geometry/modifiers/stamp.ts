import { ConeGeometry, CylinderGeometry, SphereGeometry, Quaternion, Vector3, Matrix4, BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Raycaster } from "three";
import type { Vec3 } from "../../domain/types";
import { fromThree, type MeshData } from "../csg";

export type StampParameters = {
  shape: "hole" | "dent" | "spike";
  center: Vec3;
  normal: Vec3;
  radius: number;
  depth: number;
  count: number;
  spread: number;
  seed: number;
  mirror: "off" | "x" | "y" | "z";
}

export function parseStampParameters(input: unknown): StampParameters {
  const fail = () => { throw new Error("Некорректный штамп: проверьте форму, нормаль, размеры, начальное значение генератора и число повторений (1–16)."); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const p = input as Record<string, unknown>;
  if (Object.keys(p).sort().join() !== "center,count,depth,mirror,normal,radius,seed,shape,spread") return fail();
  const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000);
  const number = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (!vector(p.center) || !vector(p.normal) || Math.abs(Math.hypot(...p.normal) - 1) > 1e-5
    || !["hole", "dent", "spike"].includes(String(p.shape)) || !["off", "x", "y", "z"].includes(String(p.mirror))
    || !number(p.radius, .005, 100) || !number(p.depth, .005, 100) || !number(p.spread, 0, 100)
    || !number(p.count, 1, 16) || !Number.isInteger(p.count) || !number(p.seed, 0, 4294967295) || !Number.isInteger(p.seed)) return fail();
  return structuredClone(p) as unknown as StampParameters;
}

/** Seeded repeats stay in the sampled tangent plane; mirror reflects both origin and normal. */
export function stampPlacements(parameters: StampParameters): { center: Vec3; normal: Vec3 }[] {
  const p = parseStampParameters(parameters), normal = new Vector3(...p.normal);
  const tangent = new Vector3(Math.abs(normal.x) < .9 ? 1 : 0, Math.abs(normal.x) < .9 ? 0 : 1, 0).cross(normal).normalize();
  const bitangent = normal.clone().cross(tangent);
  let seed = p.seed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const result: { center: Vec3; normal: Vec3 }[] = [], seen = new Set<string>();
  for (let i = 0; i < p.count; i++) {
    const angle = random() * Math.PI * 2, distance = i === 0 ? 0 : Math.sqrt(random()) * p.spread;
    const center = new Vector3(...p.center).addScaledVector(tangent, Math.cos(angle) * distance).addScaledVector(bitangent, Math.sin(angle) * distance);
    for (let mirrored = 0; mirrored < (p.mirror === "off" ? 1 : 2); mirrored++) {
      const c = center.toArray(), n = normal.toArray();
      if (mirrored) { const axis = "xyz".indexOf(p.mirror); c[axis] = -c[axis]!; n[axis] = -n[axis]!; }
      const key = JSON.stringify([c, n]); if (!seen.has(key)) { seen.add(key); result.push({ center: c, normal: n }); }
    }
  }
  return result;
}

export async function stampMeshes(parameters: StampParameters, surface?: MeshData, signal?:AbortSignal): Promise<MeshData[]> {
  signal?.throwIfAborted();
  if(surface&&surface.indices.length/3>50000)throw new Error("Штампы поддерживают до 50 000 треугольников на входе одного генератора.");
  const p = parseStampParameters(parameters);
  const placements=stampPlacements(p);
  if(surface){
    const geometry=new BufferGeometry();geometry.setAttribute("position",new BufferAttribute(surface.positions,3));geometry.setIndex(new BufferAttribute(surface.indices,1));geometry.computeBoundingBox();
    const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material),box=geometry.boundingBox!;
    try{
      for(const placement of placements){
        await new Promise<void>(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();
        const normal=new Vector3(...placement.normal),center=new Vector3(...placement.center);
        const distance=box.getSize(new Vector3()).length()+center.distanceTo(box.getCenter(new Vector3()))+p.depth+1;
        const ray=new Raycaster(center.clone().addScaledVector(normal,distance),normal.clone().negate(),0,distance*2);
        const hit=ray.intersectObject(mesh,false).sort((a,b)=>a.point.distanceToSquared(center)-b.point.distanceToSquared(center))[0];
        if(!hit?.face)throw new Error("Повторение штампа не попало на поверхность: уменьшите разброс или измените центр/нормаль.");
        placement.center=hit.point.toArray();placement.normal=hit.face.normal.clone().normalize().toArray();
      }
    }finally{geometry.dispose();material.dispose();}
  }
  return placements.map(placement => {
    // Small overlap makes spikes fuse with the substrate rather than merely touch it.
    const geometry = p.shape === "spike" ? new ConeGeometry(p.radius, p.depth, 16)
      : p.shape === "hole" ? new CylinderGeometry(p.radius, p.radius, p.depth * 1.02, 16)
        : new SphereGeometry(1, 20, 12);
    try {
      if (p.shape === "dent") geometry.scale(p.radius, p.depth, p.radius);
      const normal = new Vector3(...placement.normal);
      const offset = p.shape === "spike" ? p.depth * .45 : p.shape === "hole" ? -p.depth * .49 : 0;
      const center = new Vector3(...placement.center).addScaledVector(normal, offset);
      geometry.applyMatrix4(new Matrix4().compose(center, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal), new Vector3(1, 1, 1)));
      return fromThree(geometry);
    } finally { geometry.dispose(); }
  });
}
