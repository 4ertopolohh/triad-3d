import type { EntityId, Keyframe, Light, Node, Project } from "./types";
import { validatePrimitiveSource } from "../geometry/primitives";

export type ValidationCode =
  | "DUPLICATE_ID"
  | "MISSING_REFERENCE"
  | "INVALID_HIERARCHY"
  | "HIERARCHY_CYCLE"
  | "DEPENDENCY_CYCLE"
  | "INVALID_NUMBER"
  | "INVALID_STRUCTURE";

export interface ValidationIssue {
  code: ValidationCode;
  path: string;
  message: string;
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const entities = new Map<EntityId, string>();
  const register = (id: EntityId, path: string): void => {
    const previous = entities.get(id);
    if (previous !== undefined) {
      issues.push({ code: "DUPLICATE_ID", path, message: `ID «${id}» уже используется в ${previous}.` });
    } else {
      entities.set(id, path);
    }
  };
  const finite = (value: number, path: string): void => {
    if (!Number.isFinite(value)) issues.push({ code: "INVALID_NUMBER", path, message: "Значение должно быть конечным числом." });
  };
  const reference = (id: EntityId, known: Set<EntityId>, path: string): void => {
    if (!known.has(id)) issues.push({ code: "MISSING_REFERENCE", path, message: `Ссылка «${id}» не найдена.` });
  };

  register(project.id, "id");
  register(project.model.id, "model.id");
  finite(project.model.revision, "model.revision");
  register(project.scene.id, "scene.id");
  for (const [index, node] of project.nodes.entries()) register(node.id, `nodes[${index}].id`);
  for (const [index, modifier] of project.modifiers.entries()) register(modifier.id, `modifiers[${index}].id`);
  for (const [index, material] of project.materials.entries()) register(material.id, `materials[${index}].id`);
  for (const [index, asset] of project.assets.entries()) register(asset.id, `assets[${index}].id`);
  for (const [index, light] of project.scene.lights.entries()) register(light.id, `scene.lights[${index}].id`);
  for (const [index, instance] of project.scene.instances.entries()) register(instance.id, `scene.instances[${index}].id`);
  for (const [index, clip] of project.animations.entries()) register(clip.id, `animations[${index}].id`);
  for (const [index, track] of project.tracks.entries()) register(track.id, `tracks[${index}].id`);
  for (const [index, keyframe] of project.keyframes.entries()) register(keyframe.id, `keyframes[${index}].id`);

  const nodeIds = new Set(project.nodes.map((node) => node.id));
  const modifierIds = new Set(project.modifiers.map((modifier) => modifier.id));
  const materialIds = new Set(project.materials.map((material) => material.id));
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const trackIds = new Set(project.tracks.map((track) => track.id));
  const keyframeIds = new Set(project.keyframes.map((keyframe) => keyframe.id));

  const root = project.nodes.find((node) => node.id === project.model.rootNodeId);
  if (root === undefined) {
    issues.push({ code: "MISSING_REFERENCE", path: "model.rootNodeId", message: "Корневой узел модели не найден." });
  } else if (root.parentId !== null) {
    issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${root.id}.parentId`, message: "Корневой узел не может иметь родителя." });
  }

  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const booleanEdges = new Map<EntityId, EntityId[]>();
  for (const node of project.nodes) {
    if (node.id !== project.model.rootNodeId && node.parentId === null) {
      issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${node.id}.parentId`, message: "Только корневой узел может не иметь родителя." });
    }
    const childSet = new Set<EntityId>();
    for (const childId of node.children) {
      if (childSet.has(childId)) issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${node.id}.children`, message: `Дочерний узел «${childId}» указан повторно.` });
      childSet.add(childId);
      const child = nodesById.get(childId);
      if (child === undefined) issues.push({ code: "MISSING_REFERENCE", path: `nodes.${node.id}.children`, message: `Дочерний узел «${childId}» не найден.` });
      else if (child.parentId !== node.id) issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${node.id}.children`, message: `Узел «${childId}» не ссылается на родителя «${node.id}».` });
    }
    if (node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (parent === undefined) issues.push({ code: "MISSING_REFERENCE", path: `nodes.${node.id}.parentId`, message: `Родитель «${node.parentId}» не найден.` });
      else if (!parent.children.includes(node.id)) issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${node.id}.parentId`, message: `Родитель «${node.parentId}» не содержит узел в children.` });
    }
    checkTransform(node, finite, `nodes.${node.id}.transform`);
    if (node.kind === "mesh") {
      if (node.meshSource.kind === "asset") reference(node.meshSource.assetId, assetIds, `nodes.${node.id}.meshSource.assetId`);
      else {
        const message = validatePrimitiveSource(node.meshSource);
        if (message) issues.push({ code: "INVALID_STRUCTURE", path: `nodes.${node.id}.meshSource`, message });
      }
    }
    for (const [slotIndex, slot] of node.materialSlots.entries()) reference(slot.materialId, materialIds, `nodes.${node.id}.materialSlots[${slotIndex}].materialId`);
    const seenModifiers = new Set<EntityId>();
    for (const [modifierIndex, modifierId] of node.modifierIds.entries()) {
      if (seenModifiers.has(modifierId)) issues.push({ code: "INVALID_STRUCTURE", path: `nodes.${node.id}.modifierIds[${modifierIndex}]`, message: "ID модификатора повторяется в стеке." });
      seenModifiers.add(modifierId);
      reference(modifierId, modifierIds, `nodes.${node.id}.modifierIds[${modifierIndex}]`);
      const modifier = project.modifiers.find((candidate) => candidate.id === modifierId);
      if (modifier && modifier.nodeId !== node.id) issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${node.id}.modifierIds[${modifierIndex}]`, message: "Модификатор привязан к другому узлу." });
    }
    const orderedModifiers = node.modifierIds
      .map((id) => project.modifiers.find((modifier) => modifier.id === id))
      .filter((modifier) => modifier !== undefined);
    for (let index = 1; index < orderedModifiers.length; index += 1) {
      const previous = orderedModifiers[index - 1];
      const current = orderedModifiers[index];
      if (previous && current && previous.order >= current.order) {
        issues.push({ code: "INVALID_STRUCTURE", path: `nodes.${node.id}.modifierIds`, message: "Порядок стека должен строго соответствовать значениям order." });
        break;
      }
    }
  }

  if (root !== undefined) {
    const visited = new Set<EntityId>();
    const active = new Set<EntityId>();
    const visit = (node: Node): void => {
      if (active.has(node.id)) {
        issues.push({ code: "HIERARCHY_CYCLE", path: `nodes.${node.id}`, message: "В иерархии обнаружен цикл." });
        return;
      }
      if (visited.has(node.id)) return;
      active.add(node.id);
      visited.add(node.id);
      for (const childId of node.children) {
        const child = nodesById.get(childId);
        if (child) visit(child);
      }
      active.delete(node.id);
    };
    visit(root);
    for (const node of project.nodes) {
      if (!visited.has(node.id)) issues.push({ code: "INVALID_HIERARCHY", path: `nodes.${node.id}`, message: "Узел недостижим из корня модели (возможен отдельный цикл)." });
    }
  }

  project.scene.camera.position.forEach((value, index) => finite(value, `scene.camera.position[${index}]`));
  project.scene.camera.target.forEach((value, index) => finite(value, `scene.camera.target[${index}]`));
  finite(project.scene.camera.fovDegrees, "scene.camera.fovDegrees");
  finite(project.scene.camera.near, "scene.camera.near");
  finite(project.scene.camera.far, "scene.camera.far");
  project.scene.background.color.forEach((value, index) => finite(value, `scene.background.color[${index}]`));
  finite(project.scene.background.intensity, "scene.background.intensity");
  if (project.scene.background.environmentAssetId) reference(project.scene.background.environmentAssetId, assetIds, "scene.background.environmentAssetId");
  project.scene.lights.forEach((light, index) => validateLight(light, index, finite));
  project.scene.instances.forEach((instance, index) => {
    reference(instance.modelId, new Set([project.model.id]), `scene.instances[${index}].modelId`);
    checkTransform(instance, finite, `scene.instances[${index}].transform`);
  });

  for (const modifier of project.modifiers) {
    reference(modifier.nodeId, nodeIds, `modifiers.${modifier.id}.nodeId`);
    finite(modifier.order, `modifiers.${modifier.id}.order`);
    finite(modifier.version, `modifiers.${modifier.id}.version`);
    if (!Number.isSafeInteger(modifier.order) || modifier.order < 0 || !Number.isSafeInteger(modifier.version) || modifier.version < 0)
      issues.push({ code: "INVALID_NUMBER", path: `modifiers.${modifier.id}`, message: "Порядок и версия должны быть неотрицательными целыми числами." });
    if (!project.nodes.find((node) => node.id === modifier.nodeId)?.modifierIds.includes(modifier.id)) {
      issues.push({ code: "INVALID_HIERARCHY", path: `modifiers.${modifier.id}.nodeId`, message: "Узел не содержит ID модификатора в ordered stack." });
    }
    for (const [name, value] of Object.entries(modifier.parameters)) {
      if (typeof value === "number") finite(value, `modifiers.${modifier.id}.parameters.${name}`);
      else if (Array.isArray(value)) value.forEach((component, index) => finite(component, `modifiers.${modifier.id}.parameters.${name}[${index}]`));
    }
    if (modifier.kind === "boolean") {
      const params = modifier.parameters;
      const keys = Object.keys(params);
      if (keys.length !== 2 || !keys.includes("operation") || !keys.includes("cutterNodeId")
        || !["subtract", "union", "intersect"].includes(String(params.operation))
        || typeof params.cutterNodeId !== "string" || !params.cutterNodeId.trim()) {
        issues.push({ code: "INVALID_STRUCTURE", path: `modifiers.${modifier.id}.parameters`, message: "Некорректные параметры Boolean." });
      } else {
        const owner = nodesById.get(modifier.nodeId);
        const cutter = nodesById.get(params.cutterNodeId);
        if (owner?.kind !== "mesh" || (owner.meshSource.kind === "primitive" && owner.meshSource.primitive === "plane"))
          issues.push({ code: "INVALID_STRUCTURE", path: `modifiers.${modifier.id}.nodeId`, message: "Boolean target должен быть замкнутым mesh." });
        if (!cutter || cutter.kind !== "mesh" || (cutter.meshSource.kind === "primitive" && cutter.meshSource.primitive === "plane"))
          issues.push({ code: "MISSING_REFERENCE", path: `modifiers.${modifier.id}.parameters.cutterNodeId`, message: "Boolean cutter должен быть существующим замкнутым mesh." });
        if (owner?.kind === "mesh" && cutter?.kind === "mesh")
          booleanEdges.set(owner.id, [...booleanEdges.get(owner.id) ?? [], cutter.id]);
      }
    }
  }
  const visitedBoolean = new Set<EntityId>();
  const activeBoolean = new Set<EntityId>();
  for (const start of booleanEdges.keys()) {
    if (visitedBoolean.has(start)) continue;
    const stack: { id: EntityId; next: number }[] = [{ id: start, next: 0 }];
    activeBoolean.add(start);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const edges = booleanEdges.get(frame.id) ?? [];
      if (frame.next === edges.length) {
        activeBoolean.delete(frame.id);
        visitedBoolean.add(frame.id);
        stack.pop();
        continue;
      }
      const next = edges[frame.next++]!;
      if (activeBoolean.has(next)) {
        issues.push({ code: "DEPENDENCY_CYCLE", path: `nodes.${frame.id}.modifierIds`, message: "Обнаружен цикл зависимостей Boolean." });
        continue;
      }
      if (!visitedBoolean.has(next)) { activeBoolean.add(next); stack.push({ id: next, next: 0 }); }
    }
  }
  for (const material of project.materials) {
    [material.metalness, material.roughness, material.opacity, material.transmission, material.ior, material.clearcoat, material.envIntensity]
      .forEach((value, index) => finite(value, `materials.${material.id}.pbr[${index}]`));
    material.baseColor.forEach((value, index) => finite(value, `materials.${material.id}.baseColor[${index}]`));
    material.emissive.forEach((value, index) => finite(value, `materials.${material.id}.emissive[${index}]`));
    material.textureAssetIds.forEach((assetId, index) => reference(assetId, assetIds, `materials.${material.id}.textureAssetIds[${index}]`));
  }
  for (const clip of project.animations) {
    finite(clip.durationSeconds, `animations.${clip.id}.durationSeconds`);
    for (const trackId of clip.trackIds) reference(trackId, trackIds, `animations.${clip.id}.trackIds`);
  }
  for (const track of project.tracks) {
    reference(track.nodeId, nodeIds, `tracks.${track.id}.nodeId`);
    const usedKeys = new Set<EntityId>();
    for (const keyframeId of track.keyframeIds) {
      if (usedKeys.has(keyframeId)) issues.push({ code: "INVALID_STRUCTURE", path: `tracks.${track.id}.keyframeIds`, message: `Ключ «${keyframeId}» повторяется.` });
      usedKeys.add(keyframeId);
      reference(keyframeId, keyframeIds, `tracks.${track.id}.keyframeIds`);
    }
  }
  for (const keyframe of project.keyframes) validateKeyframe(keyframe, finite);
  return issues;
}

function checkTransform(
  value: { transform: { position: readonly number[]; rotationQuat: readonly number[]; scale: readonly number[] } },
  finite: (value: number, path: string) => void,
  path: string,
): void {
  value.transform.position.forEach((number, index) => finite(number, `${path}.position[${index}]`));
  value.transform.rotationQuat.forEach((number, index) => finite(number, `${path}.rotationQuat[${index}]`));
  value.transform.scale.forEach((number, index) => finite(number, `${path}.scale[${index}]`));
}

function validateLight(light: Light, index: number, finite: (value: number, path: string) => void): void {
  finite(light.intensity, `scene.lights[${index}].intensity`);
  light.color.forEach((value, component) => finite(value, `scene.lights[${index}].color[${component}]`));
  light.position.forEach((value, component) => finite(value, `scene.lights[${index}].position[${component}]`));
  light.target.forEach((value, component) => finite(value, `scene.lights[${index}].target[${component}]`));
}

function validateKeyframe(keyframe: Keyframe, finite: (value: number, path: string) => void): void {
  finite(keyframe.timeSeconds, `keyframes.${keyframe.id}.timeSeconds`);
  if (typeof keyframe.value === "number") finite(keyframe.value, `keyframes.${keyframe.id}.value`);
  else keyframe.value.forEach((value, component) => finite(value, `keyframes.${keyframe.id}.value[${component}]`));
}
