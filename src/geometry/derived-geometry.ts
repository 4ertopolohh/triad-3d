import { BufferAttribute, BufferGeometry } from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { MeshData } from "./csg";

/** Preserve solid creases while smoothing curved cuts; domain topology stays untouched. */
export function derivedGeometry(mesh: MeshData): BufferGeometry {
  const source = new BufferGeometry();
  source.setAttribute("position",new BufferAttribute(mesh.positions.slice(),3));
  source.setIndex(new BufferAttribute(mesh.indices.slice(),1));
  if (!mesh.indices.length) return source;
  try { return toCreasedNormals(source,Math.PI/3); }
  finally { source.dispose(); }
}
