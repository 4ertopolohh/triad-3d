import type { Material, Node, Project } from "../../domain/types";
import { validateProject } from "../../domain/validate-project";

export type ExportDiagnostic = { code: string; path: string; message: string };
export type SpikeExport = {
  filename: "TriadModel.tsx";
  source: string;
  dependencies: Readonly<Record<"react" | "three", string>>;
  diagnostics: ExportDiagnostic[];
};

export class SpikeExportError extends Error {
  constructor(public readonly code: "INVALID_PROJECT" | "EXPORT_UNSUPPORTED", public readonly issues: readonly ExportDiagnostic[]) {
    super(`${code}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}

type ExportNode = {
  id: string;
  name: string;
  kind: "group" | "mesh";
  visible: boolean;
  transform: Node["transform"];
  dimensions?: readonly [number, number, number];
  material?: Pick<Material, "baseColor" | "metalness" | "roughness" | "emissive" | "opacity" | "transmission" | "ior" | "clearcoat">;
  children: ExportNode[];
};

const DEFAULT_MATERIAL: NonNullable<ExportNode["material"]> = {
  baseColor: [0.7, 0.7, 0.7], metalness: 0, roughness: 0.6,
  emissive: [0, 0, 0], opacity: 1, transmission: 0, ior: 1.5, clearcoat: 0,
};

function literal(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function generateSpikeTsx(project: Project): SpikeExport {
  const validation = validateProject(project);
  if (validation.length) throw new SpikeExportError("INVALID_PROJECT", validation);

  const errors: ExportDiagnostic[] = [];
  const diagnostics: ExportDiagnostic[] = [];
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const materials = new Map(project.materials.map((material) => [material.id, material]));

  if (project.modifiers.length) errors.push({ code: "MODIFIERS_UNSUPPORTED", path: "modifiers", message: "Модификаторы не поддерживаются в spike." });
  if (project.scene.instances.length) errors.push({ code: "INSTANCES_UNSUPPORTED", path: "scene.instances", message: "Экземпляры сцены не поддерживаются в spike." });
  if (project.animations.length || project.tracks.length || project.keyframes.length) diagnostics.push({ code: "ANIMATION_OMITTED", path: "animations", message: "Экспортирована только статическая поза; анимация не включена." });
  if (project.scene.background.environmentAssetId) diagnostics.push({ code: "ENVIRONMENT_OMITTED", path: "scene.background.environmentAssetId", message: "HDRI окружение не включено." });
  if (project.scene.background.intensity !== 1) diagnostics.push({ code: "BACKGROUND_INTENSITY_OMITTED", path: "scene.background.intensity", message: "Интенсивность фона не включена." });
  if (project.assets.length) diagnostics.push({ code: "ASSETS_OMITTED", path: "assets", message: "Файлы ассетов не упакованы." });

  const visit = (node: Node): ExportNode => {
    if (node.materialSlots.length > (node.kind === "mesh" ? 1 : 0)) errors.push({ code: "MATERIAL_SLOTS_UNSUPPORTED", path: `nodes.${node.id}.materialSlots`, message: "Поддерживается один слот только у mesh." });
    let dimensions: readonly [number, number, number] | undefined;
    let material: ExportNode["material"];
    if (node.kind === "mesh") {
      const source = node.meshSource;
      if (source.kind !== "primitive" || source.primitive !== "cube") {
        errors.push({ code: "MESH_SOURCE_UNSUPPORTED", path: `nodes.${node.id}.meshSource`, message: "Поддерживается только cube primitive." });
      } else {
        const parameters = source.parameters;
        const keys = Object.keys(parameters);
        const sized = keys.length === 1 && keys[0] === "size";
        const dimensioned = keys.length === 3 && ["width", "height", "depth"].every((key) => key in parameters);
        if (!sized && !dimensioned) errors.push({ code: "CUBE_PARAMETERS_UNSUPPORTED", path: `nodes.${node.id}.meshSource.parameters`, message: "Ожидается size либо width, height, depth." });
        else {
          const size = parameters.size;
          dimensions = sized ? [size!, size!, size!] : [parameters.width!, parameters.height!, parameters.depth!];
          if (dimensions.some((value) => value <= 0)) errors.push({ code: "INVALID_CUBE_SIZE", path: `nodes.${node.id}.meshSource.parameters`, message: "Размеры cube должны быть положительными." });
        }
      }
      const slot = node.materialSlots[0];
      const assigned = slot ? materials.get(slot.materialId) : undefined;
      material = assigned ? {
        baseColor: assigned.baseColor, metalness: assigned.metalness, roughness: assigned.roughness,
        emissive: assigned.emissive, opacity: assigned.opacity, transmission: assigned.transmission,
        ior: assigned.ior, clearcoat: assigned.clearcoat,
      } : DEFAULT_MATERIAL;
      if (assigned?.textureAssetIds.length) diagnostics.push({ code: "TEXTURES_OMITTED", path: `materials.${assigned.id}.textureAssetIds`, message: "Текстуры не включены." });
      if (assigned?.textureSlots?.baseColor) diagnostics.push({ code: "TEXTURES_OMITTED", path: `materials.${assigned.id}.textureSlots.baseColor`, message: "Текстура основного цвета не включена в прототип экспорта." });
      if (assigned && assigned.envIntensity !== 1) diagnostics.push({ code: "ENV_INTENSITY_OMITTED", path: `materials.${assigned.id}.envIntensity`, message: "Интенсивность окружения не включена." });
    }
    return {
      id: node.id, name: node.name, kind: node.kind, visible: node.visible, transform: node.transform,
      ...(dimensions ? { dimensions } : {}), ...(material ? { material } : {}),
      children: node.children.map((id) => visit(nodes.get(id)!)),
    };
  };
  const root = visit(nodes.get(project.model.rootNodeId)!);
  if (errors.length) throw new SpikeExportError("EXPORT_UNSUPPORTED", errors);

  const data = { root, camera: project.scene.camera, background: project.scene.background.color, lights: project.scene.lights };
  return {
    filename: "TriadModel.tsx",
    dependencies: { react: "19.3.1", three: "0.186.1" },
    diagnostics,
    source: `import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface TriadModelProps { width?: number; height?: number }

interface RuntimeNode {
  id: string;
  name: string;
  kind: "group" | "mesh";
  visible: boolean;
  transform: { position: readonly [number, number, number]; rotationQuat: readonly [number, number, number, number]; scale: readonly [number, number, number] };
  dimensions?: readonly [number, number, number];
  material?: {
    baseColor: readonly [number, number, number]; metalness: number; roughness: number;
    emissive: readonly [number, number, number]; opacity: number; transmission: number;
    ior: number; clearcoat: number;
  };
  children: readonly RuntimeNode[];
}
const data = ${literal(data)} as const;

export default function TriadModel({ width = 640, height = 480 }: TriadModelProps) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(...data.background);
    const camera = new THREE.PerspectiveCamera(data.camera.fovDegrees, width / height, data.camera.near, data.camera.far);
    camera.position.set(...data.camera.position);
    camera.lookAt(...data.camera.target);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);
    const resources: Array<{ dispose(): void }> = [];
    const build = (node: RuntimeNode, parent: THREE.Object3D): void => {
      const object: THREE.Object3D = node.kind === "mesh" && node.dimensions && node.material
        ? (() => {
            const geometry = new THREE.BoxGeometry(...node.dimensions);
            const m = node.material;
            const material = new THREE.MeshPhysicalMaterial({
              color: new THREE.Color(...m.baseColor), metalness: m.metalness, roughness: m.roughness,
              emissive: new THREE.Color(...m.emissive), opacity: m.opacity, transparent: m.opacity < 1,
              transmission: m.transmission, ior: m.ior, clearcoat: m.clearcoat,
            });
            resources.push(geometry, material);
            return new THREE.Mesh(geometry, material);
          })()
        : new THREE.Group();
      object.name = node.name;
      object.userData.triadNodeId = node.id;
      object.visible = node.visible;
      object.position.set(...node.transform.position);
      object.quaternion.set(...node.transform.rotationQuat);
      object.scale.set(...node.transform.scale);
      parent.add(object);
      node.children.forEach((child) => build(child, object));
    };
    build(data.root, scene);
    data.lights.forEach((light) => {
      const color = new THREE.Color(...light.color);
      let object: THREE.Light;
      if (light.kind === "ambient") object = new THREE.AmbientLight(color, light.intensity);
      else if (light.kind === "directional") object = new THREE.DirectionalLight(color, light.intensity);
      else if (light.kind === "point") object = new THREE.PointLight(color, light.intensity);
      else object = new THREE.SpotLight(color, light.intensity);
      object.position.set(...light.position);
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight) {
        object.target.position.set(...light.target);
        scene.add(object.target);
      }
      scene.add(object);
    });
    renderer.render(scene, camera);
    return () => {
      resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [width, height]);
  return <div ref={mount} style={{ width, height }} />;
}
`,
  };
}
