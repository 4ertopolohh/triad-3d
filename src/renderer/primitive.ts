import * as T from "three";
import type { MeshSource } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";
import { primitiveDefinitions, validatePrimitiveSource } from "../geometry/primitives";

export function primitiveGeometry(source: DeepReadonly<Extract<MeshSource, { kind: "primitive" }>>): T.BufferGeometry {
  const error = validatePrimitiveSource(source);
  if (error) throw new Error(error);
  const p = (key: string) => source.parameters[key] ?? primitiveDefinitions[source.primitive].parameters[key]!.defaultValue;
  switch (source.primitive) {
    case "cube": return new T.BoxGeometry(source.parameters.width ?? p("size"), source.parameters.height ?? p("size"), source.parameters.depth ?? p("size"));
    case "sphere": return new T.SphereGeometry(p("radius"), p("widthSegments"), p("heightSegments"));
    case "torus": return new T.TorusGeometry(p("radius"), p("tube"), p("radialSegments"), p("tubularSegments"));
    case "cylinder": return new T.CylinderGeometry(p("radiusTop"), p("radiusBottom"), p("height"), p("radialSegments"));
    case "cone": return new T.ConeGeometry(p("radius"), p("height"), p("radialSegments"));
    case "plane": return new T.PlaneGeometry(p("width"), p("height"));
  }
}
