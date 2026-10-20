import * as T from "three";
import type { MeshSource } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";

export function primitiveGeometry(source: DeepReadonly<Extract<MeshSource, { kind: "primitive" }>>): T.BufferGeometry {
  const allowed: Record<typeof source.primitive, string[]> = {
    cube: ["size", "width", "height", "depth"], sphere: ["radius", "widthSegments", "heightSegments"],
    torus: ["radius", "tube", "radialSegments", "tubularSegments"], cylinder: ["radiusTop", "radiusBottom", "height", "radialSegments"],
    cone: ["radius", "height", "radialSegments"], plane: ["width", "height"],
  };
  for (const key of Object.keys(source.parameters)) if (!allowed[source.primitive].includes(key)) throw new Error(`Параметр примитива «${key}» пока не поддерживается.`);
  const p = (key: string, fallback: number, segment = false, zero = false) => {
    const value = source.parameters[key] ?? fallback;
    if (!Number.isFinite(value) || value < (zero ? 0 : segment ? 3 : Number.MIN_VALUE) || value > (segment ? 128 : 10000) || segment && !Number.isInteger(value))
      throw new Error(`Недопустимый параметр примитива «${key}».`);
    return value;
  };
  switch (source.primitive) {
    case "cube": return new T.BoxGeometry(p("width", p("size", 1)), p("height", p("size", 1)), p("depth", p("size", 1)));
    case "sphere": return new T.SphereGeometry(p("radius", 1), p("widthSegments", 32, true), p("heightSegments", 16, true));
    case "torus": return new T.TorusGeometry(p("radius", 1), p("tube", .25), p("radialSegments", 16, true), p("tubularSegments", 48, true));
    case "cylinder": return new T.CylinderGeometry(p("radiusTop", 1, false, true), p("radiusBottom", 1, false, true), p("height", 2), p("radialSegments", 32, true));
    case "cone": return new T.ConeGeometry(p("radius", 1), p("height", 2), p("radialSegments", 32, true));
    case "plane": return new T.PlaneGeometry(p("width", 1), p("height", 1));
  }
}
