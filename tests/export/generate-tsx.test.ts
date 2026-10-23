import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateSpikeTsx, SpikeExportError } from "../../src/spikes/export/generate-tsx";
import {
  createInvalidHierarchyProject, createInvalidNumberProject, createMaterialAnimationProject,
  createNestedMeshProject,
} from "../fixtures/projects";

describe("TASK-004 TSX export spike", () => {
  it("generates code from a nested cube and preserves local hierarchy", () => {
    const project = createNestedMeshProject();
    const group = project.nodes.find((node) => node.id === "nested-group")!;
    group.transform.position = [2, 3, 4];
    const result = generateSpikeTsx(project);
    expect(result.source).toContain("new THREE.BoxGeometry(...node.dimensions)");
    expect(result.source).toContain('"position":[2,3,4]');
    expect(result.source).toContain("parent.add(object)");
    expect(result.source).toContain('"dimensions":[1,1,1]');
    expect(result.dependencies).toEqual({ react: "19.3.1", three: "0.186.1" });
    expect(result.source).not.toMatch(/from ["'][^"']*src\//);
  });

  it("responds to supported geometry, transform, visibility and material values", () => {
    const project = createMaterialAnimationProject();
    const mesh = project.nodes.find((node) => node.kind === "mesh")!;
    const before = generateSpikeTsx(project).source;
    if (mesh.meshSource.kind !== "primitive") throw new Error("Invalid fixture");
    mesh.meshSource.parameters.size = 2;
    mesh.transform.position = [1, 0, 0];
    mesh.visible = false;
    project.materials[0]!.roughness = 0.4;
    const after = generateSpikeTsx(project).source;
    expect(after).not.toBe(before);
    expect(after).toContain('"dimensions":[2,2,2]');
    expect(after).toContain('"position":[1,0,0]');
    expect(after).toContain('"visible":false');
    expect(after).toContain('"roughness":0.4');
  });

  it("is deterministic and does not mutate its input", () => {
    const project = createMaterialAnimationProject();
    const original = structuredClone(project);
    expect(generateSpikeTsx(project)).toEqual(generateSpikeTsx(project));
    expect(project).toEqual(original);
  });
  it("reports an omitted baseColor texture in the spike export", () => {
    const project = createMaterialAnimationProject();
    project.assets.push({ id: "image", hash: "a".repeat(64), mediaType: "image/png", path: "assets/image.png", colorSpace: "srgb" });
    project.materials[0]!.textureSlots = { baseColor: "image" };
    expect(generateSpikeTsx(project).diagnostics).toContainEqual(expect.objectContaining({ code: "TEXTURES_OMITTED", path: "materials.material-1.textureSlots.baseColor" }));
  });

  it("rejects invalid numbers and hierarchy without mutation", () => {
    for (const project of [createInvalidNumberProject(), createInvalidHierarchyProject()]) {
      const original = structuredClone(project);
      expect(() => generateSpikeTsx(project)).toThrowError(SpikeExportError);
      expect(project).toEqual(original);
    }
  });

  it("rejects unsupported mesh and modifiers, diagnoses omitted animation", () => {
    const animated = generateSpikeTsx(createMaterialAnimationProject());
    expect(animated.diagnostics).toContainEqual(expect.objectContaining({ code: "ANIMATION_OMITTED" }));
    const project = createNestedMeshProject();
    const mesh = project.nodes.find((node) => node.kind === "mesh")!;
    mesh.meshSource = { kind: "primitive", primitive: "sphere", parameters: { radius: 1 } };
    expect(() => generateSpikeTsx(project)).toThrowError(expect.objectContaining({ code: "EXPORT_UNSUPPORTED" }));
    const modified = createNestedMeshProject();
    const modifiedMesh = modified.nodes.find((node) => node.kind === "mesh")!;
    modifiedMesh.modifierIds.push("modifier-1");
    modified.modifiers.push({ id: "modifier-1", nodeId: modifiedMesh.id, kind: "mirror", order: 0, enabled: true, version: 1, parameters: { axes: "x", pivot: [0, 0, 0], mergeSeam: false } });
    expect(() => generateSpikeTsx(modified)).toThrowError(expect.objectContaining({ code: "EXPORT_UNSUPPORTED" }));
    const missingMaterial = createMaterialAnimationProject();
    missingMaterial.materials.length = 0;
    expect(() => generateSpikeTsx(missingMaterial)).toThrowError(expect.objectContaining({ code: "INVALID_PROJECT" }));
  });

  it("escapes user strings as data", () => {
    const project = createNestedMeshProject();
    project.nodes[1]!.name = '</script><script>alert("x")</script>';
    const source = generateSpikeTsx(project).source;
    expect(source).not.toContain("</script>");
    expect(source).toContain("\\u003c/script\\u003e");
  });

  it("typechecks and builds the generated component outside the repository", () => {
    execFileSync(process.execPath, ["scripts/check-export-harness.mjs"], {
      cwd: process.cwd(), stdio: "inherit", timeout: 180_000,
    });
  }, 200_000);
});
