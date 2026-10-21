import * as T from "three";
import type { Material } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";

export function createPhysicalMaterial(value?: DeepReadonly<Material>): T.MeshPhysicalMaterial {
  if (!value) return new T.MeshPhysicalMaterial({ color: 0xaaaaaa, roughness: .65 });
  return new T.MeshPhysicalMaterial({ color: new T.Color(...value.baseColor), metalness: value.metalness, roughness: value.roughness,
    emissive: new T.Color(...value.emissive), opacity: value.opacity, transparent: value.transmission === 0 && value.opacity < 1,
    transmission: value.transmission, ior: value.ior, clearcoat: value.clearcoat, envMapIntensity: value.envIntensity });
}
