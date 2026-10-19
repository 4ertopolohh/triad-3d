import { describe, expect, it } from "vitest";
import { createProject } from "../../src/domain/create-project";
import { validateProject } from "../../src/domain/validate-project";
import {
  createDuplicateIdProject,
  createInvalidHierarchyProject,
  createInvalidNumberProject,
  createMaterialAnimationProject,
  createMissingReferenceProject,
  createNestedMeshProject,
  emptyProject,
} from "../fixtures/projects";

describe("project document graph", () => {
  it("creates a valid empty project with one model, scene, root and default camera/environment", () => {
    expect(validateProject(emptyProject)).toEqual([]);
    expect(emptyProject.nodes).toHaveLength(1);
    expect(emptyProject.model.rootNodeId).toBe(emptyProject.nodes[0]?.id);
    expect(emptyProject.scene.camera.projection).toBe("perspective");
    expect(emptyProject.scene.lights).toHaveLength(1);
    expect(emptyProject.scene.instances).toEqual([]);
  });

  it("generates distinct stable entity ids through the supplied id factory", () => {
    let sequence = 0;
    const project = createProject(() => `generated-${++sequence}`);
    expect(project.id).toBe("generated-1");
    expect(project.model.id).toBe("generated-2");
    expect(validateProject(project)).toEqual([]);
  });

  it("accepts nested groups and a parameterized mesh source", () => {
    const project = createNestedMeshProject();
    expect(validateProject(project)).toEqual([]);
    expect(project.nodes.some((node) => node.kind === "mesh" && node.meshSource.kind === "primitive")).toBe(true);
  });

  it("accepts material and animation references", () => {
    const project = createMaterialAnimationProject();
    expect(validateProject(project)).toEqual([]);
  });

  it("diagnoses a modifier list that disagrees with explicit stack order", () => {
    const project = createNestedMeshProject();
    const mesh = project.nodes.find((node) => node.kind === "mesh");
    if (!mesh) throw new Error("Fixture mesh missing");
    mesh.modifierIds.push("modifier-a", "modifier-b");
    project.modifiers.push(
      { id: "modifier-a", nodeId: mesh.id, kind: "mirror", order: 2, enabled: true, version: 1, parameters: {} },
      { id: "modifier-b", nodeId: mesh.id, kind: "bevel", order: 1, enabled: true, version: 1, parameters: {} },
    );
    expect(validateProject(project).some((issue) => issue.code === "INVALID_STRUCTURE")).toBe(true);
  });

  it("reports duplicate IDs", () => {
    expect(validateProject(createDuplicateIdProject()).some((issue) => issue.code === "DUPLICATE_ID")).toBe(true);
  });

  it("reports inconsistent parent/children links and hierarchy cycles", () => {
    const issues = validateProject(createInvalidHierarchyProject());
    expect(issues.some((issue) => issue.code === "HIERARCHY_CYCLE")).toBe(true);
    expect(issues.some((issue) => issue.code === "INVALID_HIERARCHY")).toBe(true);
  });

  it("reports non-finite transform values", () => {
    expect(validateProject(createInvalidNumberProject()).some((issue) => issue.code === "INVALID_NUMBER")).toBe(true);
  });

  it("reports missing references", () => {
    expect(validateProject(createMissingReferenceProject()).some((issue) => issue.code === "MISSING_REFERENCE")).toBe(true);
  });
});
