export type EntityId = string;
export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export type ColorRgb = readonly [number, number, number];

export interface Transform {
  position: Vec3;
  rotationQuat: Quaternion;
  scale: Vec3;
}

export interface Project {
  schemaVersion: string;
  id: EntityId;
  name: string;
  model: Model;
  scene: Scene;
  nodes: Node[];
  modifiers: Modifier[];
  materials: Material[];
  assets: Asset[];
  animations: AnimationClip[];
  tracks: Track[];
  keyframes: Keyframe[];
}

export interface Model {
  id: EntityId;
  rootNodeId: EntityId;
  revision: number;
}

export interface Scene {
  id: EntityId;
  camera: CameraState;
  background: SceneBackground;
  lights: Light[];
  instances: Instance[];
}

export interface CameraState {
  projection: "perspective";
  position: Vec3;
  target: Vec3;
  fovDegrees: number;
  near: number;
  far: number;
}

export interface SceneBackground {
  color: ColorRgb;
  environmentAssetId?: EntityId;
  intensity: number;
}

export interface Light {
  id: EntityId;
  kind: "ambient" | "directional" | "point" | "spot";
  color: ColorRgb;
  intensity: number;
  position: Vec3;
  target: Vec3;
}

export interface Instance {
  id: EntityId;
  modelId: EntityId;
  transform: Transform;
  visible: boolean;
}

export interface GroupNode {
  id: EntityId;
  kind: "group";
  name: string;
  parentId: EntityId | null;
  children: EntityId[];
  transform: Transform;
  visible: boolean;
  locked: boolean;
  materialSlots: MaterialSlot[];
  modifierIds: EntityId[];
}

export interface MeshNode extends Omit<GroupNode, "kind"> {
  kind: "mesh";
  meshSource: MeshSource;
}

export type Node = GroupNode | MeshNode;

export interface MaterialSlot {
  name: string;
  materialId: EntityId;
}

export type MeshSource =
  | { kind: "primitive"; primitive: "cube" | "sphere" | "torus" | "cylinder" | "cone" | "plane"; parameters: Record<string, number> }
  | { kind: "asset"; assetId: EntityId };

export interface Modifier {
  id: EntityId;
  nodeId: EntityId;
  kind: "boolean" | "mirror" | "array" | "bend" | "twist" | "taper" | "bevel";
  order: number;
  enabled: boolean;
  version: number;
  parameters: Record<string, number | string | boolean | readonly number[]>;
}

export interface Material {
  id: EntityId;
  name: string;
  baseColor: ColorRgb;
  metalness: number;
  roughness: number;
  emissive: ColorRgb;
  opacity: number;
  transmission: number;
  ior: number;
  clearcoat: number;
  envIntensity: number;
  textureAssetIds: EntityId[];
}

export interface Asset {
  id: EntityId;
  hash: string;
  mediaType: string;
  path: string;
  colorSpace: "srgb" | "linear" | "none";
}

export interface AnimationClip {
  id: EntityId;
  name: string;
  durationSeconds: number;
  loop: boolean;
  trackIds: EntityId[];
}

export type TrackProperty = "transform.position" | "transform.rotationQuat" | "transform.scale";
export type KeyframeValue = number | Vec3 | Quaternion;

export interface Track {
  id: EntityId;
  nodeId: EntityId;
  property: TrackProperty;
  keyframeIds: EntityId[];
}

export interface Keyframe {
  id: EntityId;
  timeSeconds: number;
  value: KeyframeValue;
  interpolation: "step" | "linear" | "bezier";
}
