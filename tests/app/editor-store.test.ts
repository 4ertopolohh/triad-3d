import { describe, expect, it, vi } from "vitest";
import { applyProjectPatch } from "../../src/domain";
import type { ProjectCommand } from "../../src/domain";
import { createEditorStore, selectDerived, selectDirty, selectProject, selectRevision } from "../../src/app/editor-store";
import { createNestedMeshProject } from "../fixtures/projects";
import { AssetBytes } from "../../src/assets/asset-bytes";

const rename = (name: string, nodeId = "mesh-node", commandId = "rename"): ProjectCommand => ({
  commandId, type: "RENAME_NODE", targetIds: [nodeId], payload: { nodeId, name },
});

describe("editor store", () => {
  it("initializes a stable, immutable RAM snapshot independently of its input", () => {
    const input = createNestedMeshProject();
    const store = createEditorStore(input);
    const snapshot = store.getSnapshot();
    input.nodes[0]?.children.push("external");
    expect(store.getSnapshot()).toBe(snapshot);
    expect(selectProject(snapshot).nodes[0]?.children).not.toContain("external");
    expect(selectRevision(snapshot)).toBe(0);
    expect(selectDirty(snapshot)).toBe(false);
    expect(snapshot.job.status).toBe("idle");
    expect(Object.isFrozen(snapshot.document.project.nodes[0]?.children)).toBe(true);
    expect(() => { (snapshot.document.project.nodes as unknown as string[]).push("external"); }).toThrow();
    expect(store.getSnapshot()).toBe(snapshot);
  });

  it("publishes one complete transaction and stores reversible deltas", () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = store.getSnapshot();
    const observed: ReturnType<typeof store.getSnapshot>[] = [];
    store.subscribe(() => observed.push(store.getSnapshot()));
    const result = store.executeTransaction([
      rename("Новое имя", "mesh-node", "one"), rename("Новая деталь", "mesh-node", "two"),
    ], 0, "batch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(observed).toHaveLength(1);
    const after = observed[0]!;
    expect(after).toBe(store.getSnapshot());
    expect(after.document.project.nodes.find((node) => node.id === "mesh-node")?.name).toBe("Новая деталь");
    expect(after.document.revision).toBe(result.revision);
    expect(after.document.dirty).toBe(true);
    expect(after.derived).toEqual({ generation: 1, documentRevision: 1, scope: "all" });
    expect(after.history.entries).toHaveLength(1);
    expect(after.history.entries[0]?.id).toBe("batch");
    expect(applyProjectPatch(before.document.project as Parameters<typeof applyProjectPatch>[0], result.patch)).toEqual(result.project);
    expect(applyProjectPatch(result.project, result.undoPatch)).toEqual(before.document.project);
    expect(after.history.entries[0]?.patch).toEqual(result.patch);
    expect(after.history.entries[0]?.undoPatch).toEqual(result.undoPatch);
    expect(Object.isFrozen(after.history.entries[0]?.patch.changes)).toBe(true);
    result.project.nodes[0]?.children.push("caller mutation");
    expect(after.document.project.nodes[0]?.children).not.toContain("caller mutation");
  });

  it("does not publish failures or semantic no-ops", () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.executeCommand(rename("Куб"), 0)).toMatchObject({ ok: true, changed: false, revision: 0 });
    expect(store.executeCommand(rename("Wrong", "missing"), 0)).toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    expect(store.executeTransaction([rename("A", "mesh-node", "first"), rename("B", "missing", "second")], 0))
      .toMatchObject({ ok: false, code: "INVALID_REFERENCE" });
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(before.history.entries).toHaveLength(0);
    expect(selectDerived(before).generation).toBe(0);
  });

  it("keeps selection, tool and view outside document revision and derived generation", () => {
    const store = createEditorStore(createNestedMeshProject());
    const before = store.getSnapshot();
    const project = before.document.project;
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setSelection(["mesh-node", "missing", "mesh-node", "nested-group"], "nested-group");
    expect(store.getSnapshot().selection).toEqual({ ids: ["mesh-node", "nested-group"], activeId: "nested-group" });
    store.setSelection(["mesh-node", "nested-group"], "nested-group");
    store.setTool({ mode: "scene", active: "move", space: "local" });
    store.setView({ leftTab: "assets", timelineExpanded: false });
    expect(listener).toHaveBeenCalledTimes(3);
    const after = store.getSnapshot();
    expect(after.document).toBe(before.document);
    expect(after.document.project).toBe(project);
    expect(after.history).toBe(before.history);
    expect(after.derived).toBe(before.derived);
    store.setSelection(["missing"]);
    expect(store.getSnapshot().selection).toEqual({ ids: [], activeId: null });
    unsubscribe();
    store.setView({ timelineExpanded: true });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("keeps session revision distinct from model revision", () => {
    const input = createNestedMeshProject();
    input.model.revision = 7;
    const store = createEditorStore(input);
    expect(store.getSnapshot().document.revision).toBe(0);
    expect(store.getSnapshot().document.project.model.revision).toBe(7);
    expect(store.executeCommand(rename("Новое"), 0)).toMatchObject({ ok: true, revision: 1 });
    expect(store.getSnapshot().document.project.model.revision).toBe(8);
    expect(store.executeCommand(rename("Поздно"), 0)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(store.getSnapshot().document.revision).toBe(1);
  });

  it("atomically replaces project, command bus, assets, selection and history", () => {
    const store = createEditorStore(createNestedMeshProject());
    store.executeCommand(rename("Changed"), 0);
    store.setSelection(["mesh-node"]);
    const oldIdentity = store.captureDocument().identity;
    const next = createNestedMeshProject();
    next.model.revision = 17;
    const bytes = new AssetBytes([["asset", new Uint8Array([1, 2])]]);
    const seen: ReturnType<typeof store.getSnapshot>[] = [];
    store.subscribe(() => seen.push(store.getSnapshot()));
    expect(store.replaceProject({ project: next, assets: bytes }, oldIdentity)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(store.getSnapshot().document.project.model.revision).toBe(17);
    expect(store.getSnapshot().document.revision).toBe(0);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(store.getSnapshot().selection.ids).toHaveLength(0);
    expect(store.getSnapshot().document.dirty).toBe(false);
    expect(store.getAssetBytes().get("asset")).toEqual(new Uint8Array([1, 2]));
    bytes.clear();
    expect(store.getAssetBytes().get("asset")).toEqual(new Uint8Array([1, 2]));
    expect(store.replaceProject({ project: next, assets: bytes }, oldIdentity)).toBe(false);
    expect(store.executeCommand(rename("After load"), 0)).toMatchObject({ ok: true, revision: 1 });
  });

  it("does not acknowledge a stale save or replace after an edit", () => {
    const store = createEditorStore(createNestedMeshProject());
    const captured = store.captureDocument();
    store.executeCommand(rename("Later"), 0);
    expect(store.confirmSaved(captured.revision, captured.identity)).toBe(false);
    expect(store.replaceProject({ project: createNestedMeshProject(), assets: new AssetBytes() }, captured.identity)).toBe(false);
    expect(store.getSnapshot().document.dirty).toBe(true);
    const current = store.captureDocument();
    expect(store.confirmSaved(current.revision, current.identity)).toBe(true);
    expect(store.getSnapshot().document.dirty).toBe(false);
  });
});
