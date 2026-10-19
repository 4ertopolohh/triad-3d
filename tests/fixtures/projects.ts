import { createProject } from "../../src/domain/create-project";
import type { Material, MeshNode, Project } from "../../src/domain/types";

function projectWithIds(): Project {
  let next = 0;
  return createProject(() => `id-${++next}`);
}

export const emptyProject = projectWithIds();

export function createNestedMeshProject(): Project {
  const project = projectWithIds();
  const root = project.nodes[0];
  if (!root) throw new Error("Fixture root node missing");
  const groupId = "nested-group";
  const meshId = "mesh-node";
  const group = {
    id: groupId,
    kind: "group" as const,
    name: "Вложенная группа",
    parentId: root.id,
    children: [meshId],
    transform: { position: [0, 0, 0] as const, rotationQuat: [0, 0, 0, 1] as const, scale: [1, 1, 1] as const },
    visible: true,
    locked: false,
    materialSlots: [],
    modifierIds: [],
  };
  const mesh: MeshNode = {
    ...group,
    id: meshId,
    kind: "mesh",
    name: "Куб",
    parentId: groupId,
    children: [],
    materialSlots: [],
    modifierIds: [],
    meshSource: { kind: "primitive", primitive: "cube", parameters: { size: 1 } },
  };
  project.nodes.push(group, mesh);
  root.children.push(groupId);
  return project;
}

export function createMaterialAnimationProject(): Project {
  const project = createNestedMeshProject();
  const material: Material = {
    id: "material-1",
    name: "Хром",
    baseColor: [0.8, 0.8, 0.8],
    metalness: 1,
    roughness: 0.18,
    emissive: [0, 0, 0],
    opacity: 1,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0,
    envIntensity: 1,
    textureAssetIds: [],
  };
  project.materials.push(material);
  const mesh = project.nodes.find((node) => node.kind === "mesh");
  if (!mesh) throw new Error("Fixture mesh missing");
  mesh.materialSlots.push({ name: "Основной", materialId: material.id });
  project.animations.push({ id: "clip-1", name: "Подъём", durationSeconds: 2, loop: false, trackIds: ["track-1"] });
  project.tracks.push({ id: "track-1", nodeId: mesh.id, property: "transform.position", keyframeIds: ["key-1", "key-2"] });
  project.keyframes.push(
    { id: "key-1", timeSeconds: 0, value: [0, 0, 0], interpolation: "linear" },
    { id: "key-2", timeSeconds: 2, value: [0, 1, 0], interpolation: "linear" },
  );
  return project;
}

export function createInvalidHierarchyProject(): Project {
  const project = createNestedMeshProject();
  const root = project.nodes[0];
  const group = project.nodes.find((node) => node.id === "nested-group");
  if (!root || !group) throw new Error("Fixture hierarchy missing");
  root.parentId = group.id;
  group.children.push(root.id);
  return project;
}

export function createDuplicateIdProject(): Project {
  const project = createNestedMeshProject();
  const root = project.nodes[0];
  const duplicate = project.nodes.find((node) => node.id === "mesh-node");
  if (!root || !duplicate) throw new Error("Fixture nodes missing");
  duplicate.id = root.id;
  return project;
}

export function createInvalidNumberProject(): Project {
  const project = projectWithIds();
  const root = project.nodes[0];
  if (!root) throw new Error("Fixture root node missing");
  root.transform.position = [Number.NaN, 0, 0];
  return project;
}

export function createMissingReferenceProject(): Project {
  const project = createNestedMeshProject();
  const root = project.nodes[0];
  if (!root) throw new Error("Fixture root node missing");
  root.children.push("absent-node");
  return project;
}
