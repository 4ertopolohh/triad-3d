import * as T from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { materialColor, normalLocal, positionLocal, texture, varying, vec2, vec3, vec4 } from "three/tsl";
import type { BaseColorProjection } from "../domain/types";
import type { DeepReadonly } from "../app/editor-store";
import type { Material } from "../domain/types";

type Triplanar = Extract<BaseColorProjection, { mode: "triplanar" }>;

/** Fourth-power normalized local-normal weights; zero normals use equal weights. */
export function triplanarWeights(normal: readonly [number, number, number]): [number, number, number] {
  const powers = normal.map(value => Math.abs(value) ** 4);
  const sum = powers.reduce((a, b) => a + b, 0);
  return sum > 1e-20 ? powers.map(value => value / sum) as [number, number, number] : [1 / 3, 1 / 3, 1 / 3];
}

/** Negative-facing planes deliberately keep the same local UV orientation as positive faces. */
export function bindTriplanarTexture(material: MeshPhysicalNodeMaterial, image: T.Texture, projection: Triplanar): void {
  const point = varying(positionLocal);
  const normal = varying(normalLocal).normalize().abs();
  const power = normal.mul(normal);
  const fourth = power.mul(power).add(vec3(1e-20));
  const weights = fourth.div(fourth.x.add(fourth.y).add(fourth.z));
  const tiling = vec2(...projection.tiling);
  const offset = vec2(...projection.offset);
  const x = texture(image, vec2(point.z, point.y).mul(tiling).add(offset));
  const y = texture(image, vec2(point.x, point.z).mul(tiling).add(offset));
  const z = texture(image, vec2(point.x, point.y).mul(tiling).add(offset));
  const blend = x.mul(weights.x).add(y.mul(weights.y)).add(z.mul(weights.z));
  material.colorNode = vec4(materialColor.mul(blend.rgb), blend.a);
  material.needsUpdate = true;
}

export function createTriplanarMaterial(value: DeepReadonly<Material>): MeshPhysicalNodeMaterial {
  return new MeshPhysicalNodeMaterial({
    color: new T.Color(...value.baseColor), metalness: value.metalness, roughness: value.roughness,
    emissive: new T.Color(...value.emissive), opacity: value.opacity,
    transparent: value.transmission === 0 && value.opacity < 1,
    transmission: value.transmission, ior: value.ior, clearcoat: value.clearcoat,
    envMapIntensity: value.envIntensity,
  });
}
