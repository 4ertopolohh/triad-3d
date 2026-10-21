import { describe, expect, it } from "vitest";
import {
  deserializeProjectDocument, migrateProjectDocument, serializeProjectDocument,
  validateNativeManifest, type NativeManifest,
} from "../../src/domain";
import {
  emptyProject, createNestedMeshProject, createMaterialAnimationProject,
  createDuplicateIdProject, createInvalidHierarchyProject, createMissingReferenceProject,
} from "../fixtures/projects";

const clone = <T>(value: T): T => structuredClone(value);
const jsonOf = (value: unknown) => JSON.stringify(value);

describe("project document schema v1", () => {
  it.each([emptyProject, createNestedMeshProject(), createMaterialAnimationProject()])("round-trips complete projects", (project) => {
    const before = clone(project);
    const serialized = serializeProjectDocument(project);
    expect(serialized.ok, JSON.stringify(serialized)).toBe(true);
    if (!serialized.ok) return;
    expect(serializeProjectDocument(project)).toEqual(serialized);
    const restored = deserializeProjectDocument(serialized.value);
    expect(restored).toEqual({ ok: true, value: project });
    expect(project).toEqual(before);
    if (restored.ok) expect(restored.value).not.toBe(project);
  });

  it("keeps modifier ordering, assets, zero, false and optional fields", () => {
    const project = createMaterialAnimationProject();
    const mesh = project.nodes.find((node) => node.kind === "mesh");
    if (!mesh) throw new Error("Missing mesh");
    project.assets.push({ id: "asset-1", hash: "hash", mediaType: "image/png", path: "assets/x.png", colorSpace: "srgb" });
    project.scene.background.environmentAssetId = "asset-1";
    project.modifiers.push(
      { id: "modifier-1", nodeId: mesh.id, kind: "mirror", order: 0, enabled: false, version: 1, parameters: { axes: "x", pivot: [0, 0, 0], mergeSeam: false } },
      { id: "modifier-2", nodeId: mesh.id, kind: "bevel", order: 1, enabled: true, version: 1, parameters: { width: 0 } },
    );
    mesh.modifierIds.push("modifier-1", "modifier-2");
    const result = serializeProjectDocument(project);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(deserializeProjectDocument(result.value)).toEqual({ ok: true, value: project });
  });
  it("round-trips deformation stacks and rejects invalid disabled parameters", () => {
    const project = createMaterialAnimationProject();
    const mesh = project.nodes.find(node => node.kind === "mesh");
    if (!mesh) throw new Error("Missing mesh");
    const params = [
      { axis: "x", direction: "y", angleDegrees: 20, pivot: [0, 0, 0] },
      { axis: "z", angleDegrees: -30, pivot: [1, 0, 0] },
      { axis: "y", startScale: 0.5, endScale: 2, pivot: [0, 1, 0] },
      { width: 0.1 },
    ];
    for (const [order, kind] of (["bend", "twist", "taper", "bevel"] as const).entries()) {
      const id = `deform-${order}`;
      project.modifiers.push({ id, nodeId: mesh.id, kind, order, version: order + 1, enabled: order !== 1, parameters: params[order]! });
      mesh.modifierIds.push(id);
    }
    const saved = serializeProjectDocument(project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(deserializeProjectDocument(saved.value)).toEqual({ ok: true, value: project });
    project.modifiers[1]!.parameters.angleDegrees = Infinity;
    expect(serializeProjectDocument(project).ok).toBe(false);
  });

  it.each([
    ["bad JSON", "{"],
    ["missing version", jsonOf({ ...emptyProject, schemaVersion: undefined })],
    ["extra property", jsonOf({ ...emptyProject, unexpected: true })],
    ["bad enum", jsonOf({ ...emptyProject, scene: { ...emptyProject.scene, camera: { ...emptyProject.scene.camera, projection: "orthographic" } } })],
    ["bad vector", jsonOf({ ...emptyProject, scene: { ...emptyProject.scene, camera: { ...emptyProject.scene.camera, position: [1, 2] } } })],
    ["bad quaternion", jsonOf({ ...emptyProject, nodes: [{ ...emptyProject.nodes[0], transform: { ...emptyProject.nodes[0]?.transform, rotationQuat: [0, 0, 1] } }] })],
    ["bad number", jsonOf({ ...emptyProject, model: { ...emptyProject.model, revision: -1 } })],
  ])("rejects %s", (_name, input) => {
    const result = deserializeProjectDocument(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FILE_INVALID");
  });

  it.each(["2.0.0", "1.2.0", "1.0.1"])('rejects unsupported version %s', (schemaVersion) => {
    const result = deserializeProjectDocument(jsonOf({ ...emptyProject, schemaVersion }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SCHEMA_UNSUPPORTED");
  });

  it.each([createDuplicateIdProject(), createInvalidHierarchyProject(), createMissingReferenceProject()])("rejects broken domain links", (project) => {
    const result = deserializeProjectDocument(jsonOf(project));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FILE_INVALID");
  });

  it("rejects nonfinite numbers without mutating input", () => {
    const project = clone(emptyProject);
    project.scene.camera.fovDegrees = Number.POSITIVE_INFINITY;
    const result = serializeProjectDocument(project);
    expect(result.ok).toBe(false);
    expect(project.scene.camera.fovDegrees).toBe(Number.POSITIVE_INFINITY);
  });

  it("enforces input size and nesting limits", () => {
    expect(deserializeProjectDocument(" ".repeat(17 * 1024 * 1024)).ok).toBe(false);
    const deep = `${"[".repeat(70)}0${"]".repeat(70)}`;
    expect(deserializeProjectDocument(deep).ok).toBe(false);
  });

  it("provides pure migration chaining through the built-in v1 migration", () => {
    const old = { ...emptyProject, schemaVersion: "0.9.0" };
    const before = clone(old);
    const migration = { from: "0.9.0", to: "1.0.0", migrate: (input: unknown) => ({ ...(input as object), schemaVersion: "1.0.0" }) };
    expect(migrateProjectDocument(old, [migration])).toEqual({ ok: true, value: emptyProject });
    expect(old).toEqual(before);
    expect(deserializeProjectDocument(jsonOf(old), [migration])).toEqual({ ok: true, value: emptyProject });
  });
});

describe("native manifest v1", () => {
  const sha256 = "a".repeat(64);
  const manifest: NativeManifest = {
    formatVersion: "1.0.0", appVersion: "0.1.0", document: { path: "document.json", sha256 },
    assets: [{ id: "asset-1", path: "assets/image.png", sha256 }],
  };

  it("accepts the contract", () => expect(validateNativeManifest(manifest)).toEqual({ ok: true, value: manifest }));
  it.each(["../image.png", "/assets/image.png", "assets\\image.png", "assets/%2e%2e/x", "C:/x", "assets//x", "assets/./x"])('rejects unsafe path %s', (path) => {
    const candidate = clone(manifest);
    candidate.assets[0]!.path = path;
    expect(validateNativeManifest(candidate).ok).toBe(false);
  });
  it("rejects duplicate paths and invalid digests", () => {
    expect(validateNativeManifest({ ...manifest, assets: [...manifest.assets, { id: "other", path: "ASSETS/IMAGE.PNG", sha256 }] }).ok).toBe(false);
    expect(validateNativeManifest({ ...manifest, document: { ...manifest.document, sha256: "bad" } }).ok).toBe(false);
  });
});
