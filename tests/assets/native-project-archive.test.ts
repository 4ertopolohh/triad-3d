import { describe, expect, it } from "vitest";
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { AssetBytes } from "../../src/assets/asset-bytes";
import { ARCHIVE_LIMITS, createNativeProjectArchive, openNativeProjectArchive } from "../../src/assets/native-project-archive";
import { createProject } from "../../src/domain";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { createNestedMeshProject } from "../fixtures/projects";

async function zip(entries: readonly [string, string][]): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter());
  for (const [path, value] of entries) await writer.add(path, new TextReader(value));
  return writer.close();
}

describe("native project archive", () => {
  it("round-trips Array parameters, order, enabled state and version", async () => {
    const project = createProject();
    const root = project.nodes[0]!;
    const node = createPrimitiveNode("cube", root.id, "array-target");
    root.children.push(node.id); project.nodes.push(node);
    node.modifierIds.push("array-1", "array-2");
    project.modifiers.push(
      { id: "array-1", nodeId: node.id, kind: "array", order: 0, enabled: true, version: 3, parameters: { mode: "linear", count: 6, axis: "x", step: -2, offset: [0, 1, 0] } },
      { id: "array-2", nodeId: node.id, kind: "array", order: 1, enabled: false, version: 1, parameters: { mode: "radial", count: 4, axis: "z", angleStepDegrees: 90, pivot: [1, 0, 0], offset: [0, 0, 1] } },
    );
    const saved = await createNativeProjectArchive(project, new AssetBytes(), "0.1.0");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = await openNativeProjectArchive(saved.value);
    expect(loaded.ok && loaded.value.project).toEqual(project);
  });
  it("round-trips an empty project", async () => {
    const project = createProject();
    const saved = await createNativeProjectArchive(project, new AssetBytes(), "0.1.0");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = await openNativeProjectArchive(saved.value);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.project).toEqual(project);
  });

  it("round-trips hierarchy, modifiers, materials, animation and resource bytes", async () => {
    const project = createNestedMeshProject();
    const bytes = new TextEncoder().encode("actual binary resource");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
    project.assets.push({ id: "texture-1", hash, path: `assets/${hash}.png`, mediaType: "image/png", colorSpace: "srgb" });
    const source = new AssetBytes([["texture-1", bytes]]);
    const saved = await createNativeProjectArchive(project, source, "0.1.0");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    bytes[0] = 0;
    const loaded = await openNativeProjectArchive(saved.value);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.project).toEqual(project);
    expect(new TextDecoder().decode(loaded.value.assets.get("texture-1"))).toBe("actual binary resource");
    const exported = loaded.value.assets.get("texture-1")!;
    exported[0] = 0;
    expect(loaded.value.assets.get("texture-1")?.[0]).not.toBe(0);
  });

  it("rejects missing and modified resource bytes", async () => {
    const project = createProject();
    project.assets.push({ id: "a", hash: "0".repeat(64), path: `assets/${"0".repeat(64)}.png`, mediaType: "image/png", colorSpace: "srgb" });
    expect(await createNativeProjectArchive(project, new AssetBytes(), "0.1.0")).toMatchObject({ ok: false, error: { code: "ASSET_MISSING" } });
    expect(await createNativeProjectArchive(project, new AssetBytes([["a", new Uint8Array([1])]]), "0.1.0")).toMatchObject({ ok: false, error: { code: "ASSET_INTEGRITY" } });
  });

  it("rejects malformed containers, traversal, unknown paths and conflicting names", async () => {
    expect(await openNativeProjectArchive(new Blob(["not zip"]))).toMatchObject({ ok: false, error: { code: "FILE_INVALID" } });
    for (const paths of [["../manifest.json"], ["manifest.json", "MANIFEST.json"], ["manifest.json", "script.js"]]) {
      const blob = await zip(paths.map((path) => [path, "{}"]));
      expect(await openNativeProjectArchive(blob)).toMatchObject({ ok: false, error: { code: "FILE_INVALID" } });
    }
  });

  it("rejects oversized archive and invalid manifest", async () => {
    expect(await openNativeProjectArchive(new Blob([new Uint8Array(ARCHIVE_LIMITS.archive + 1)]))).toMatchObject({ ok: false, error: { code: "FILE_INVALID" } });
    const blob = await zip([["manifest.json", "{"], ["document.json", "{}"]]);
    expect(await openNativeProjectArchive(blob)).toMatchObject({ ok: false, error: { code: "FILE_INVALID" } });
  });

  it("rejects changed document checksum, unsupported versions and undeclared files", async () => {
    const saved = await createNativeProjectArchive(createProject(), new AssetBytes(), "0.1.0");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const reader = new ZipReader(new BlobReader(saved.value));
    const entries = await reader.getEntries();
    const manifestEntry = entries.find((entry) => entry.filename === "manifest.json");
    const documentEntry = entries.find((entry) => entry.filename === "document.json");
    if (!manifestEntry || manifestEntry.directory || !documentEntry || documentEntry.directory) throw new Error("fixture archive incomplete");
    const manifest = await manifestEntry.getData(new TextWriter());
    const document = await documentEntry.getData(new TextWriter());
    await reader.close();
    expect(await openNativeProjectArchive(await zip([["manifest.json", manifest], ["document.json", document + " "]]))).toMatchObject({ ok: false, error: { code: "ASSET_INTEGRITY" } });
    const newer = JSON.stringify({ ...JSON.parse(manifest), formatVersion: "2.0.0" });
    expect(await openNativeProjectArchive(await zip([["manifest.json", newer], ["document.json", document]]))).toMatchObject({ ok: false, error: { code: "SCHEMA_UNSUPPORTED" } });
    expect(await openNativeProjectArchive(await zip([["manifest.json", manifest], ["document.json", document], [`assets/${"a".repeat(64)}.png`, "orphan"]]))).toMatchObject({ ok: false, error: { code: "FILE_INVALID" } });
  });

  it("enforces the manifest expansion limit on compressed data", async () => {
    const blob = await zip([["manifest.json", "x".repeat(ARCHIVE_LIMITS.manifest + 1)], ["document.json", "{}"]]);
    expect(await openNativeProjectArchive(blob)).toMatchObject({ ok: false, error: { code: "FILE_INVALID" } });
  });
});
