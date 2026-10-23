import type { EntityId, Project } from "./types";

export type IdFactory = () => EntityId;

export function createProject(idFactory: IdFactory = () => crypto.randomUUID()): Project {
  const projectId = idFactory();
  const modelId = idFactory();
  const sceneId = idFactory();
  const rootId = idFactory();
  const lightId = idFactory();

  return {
    schemaVersion: "1.3.0",
    id: projectId,
    name: "Новый проект",
    model: { id: modelId, rootNodeId: rootId, revision: 0 },
    scene: {
      id: sceneId,
      camera: {
        projection: "perspective",
        position: [4, 3, 5],
        target: [0, 0, 0],
        fovDegrees: 45,
        near: 0.1,
        far: 1000,
      },
      background: { color: [0.12, 0.12, 0.12], intensity: 1 },
      lights: [{
        id: lightId,
        kind: "ambient",
        color: [1, 1, 1],
        intensity: 0.8,
        position: [0, 0, 0],
        target: [0, 0, 0],
      }],
      instances: [],
    },
    nodes: [{
      id: rootId,
      kind: "group",
      name: "Модель",
      parentId: null,
      children: [],
      transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      materialSlots: [],
      modifierIds: [],
    }],
    modifiers: [],
    materials: [],
    assets: [],
    animations: [],
    tracks: [],
    keyframes: [],
  };
}
