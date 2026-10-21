import { describe, expect, it, vi } from "vitest";
import { applyDeformChange } from "../../src/app/deform-actions";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import type { ModifierEvaluator } from "../../src/geometry/modifiers";

const bend = { axis: "y", direction: "x", angleDegrees: 30, pivot: [0, 0, 0] } as const;
const twist = { axis: "y", angleDegrees: 45, pivot: [0, 0, 0] } as const;
const taper = { axis: "y", startScale: 1, endScale: 0.8, pivot: [0, 0, 0] } as const;
const bevel = { width: 0.1, angleDegrees: 30 } as const;
function fixture() {
  const project = createProject(() => crypto.randomUUID());
  const root = project.nodes[0]!;
  const node = createPrimitiveNode("cube", root.id, "target");
  project.nodes.push(node); root.children.push(node.id);
  const store = createEditorStore(project);
  store.setSelection(["target"]);
  return store;
}

describe("deformation actions", () => {
  it("commits Bevel through a job and supports update, disable, remove and undo", async () => {
    const store = fixture();
    expect(await applyDeformChange(store, { type: "add", targetId: "target", kind: "bevel", parameters: bevel })).toMatchObject({ ok: true, committed: true });
    const id = store.getSnapshot().document.project.modifiers[0]!.id;
    expect(await applyDeformChange(store, { type: "update", targetId: "target", modifierId: id, parameters: { width: 0.15 } })).toMatchObject({ ok: true, committed: true });
    expect(await applyDeformChange(store, { type: "enable", targetId: "target", modifierId: id, enabled: false })).toMatchObject({ ok: true, committed: true });
    expect(await applyDeformChange(store, { type: "remove", targetId: "target", modifierId: id })).toMatchObject({ ok: true, committed: true });
    const revision = store.getSnapshot().document.revision;
    expect(store.undo(revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.modifiers[0]?.id).toBe(id);
    expect(store.redo(revision + 1).ok).toBe(true);
    expect(store.getSnapshot().job.status).not.toBe("running");
  });
  it("rolls back failed Bevel geometry and invalid width", async () => {
    const store = fixture();
    const before = store.getSnapshot();
    expect((await applyDeformChange(store, { type: "add", targetId: "target", kind: "bevel", parameters: { width: 2 } })).ok).toBe(false);
    expect((await applyDeformChange(store, { type: "add", targetId: "target", kind: "bevel", parameters: { width: -1 } })).ok).toBe(false);
    expect(store.getSnapshot().document).toEqual(before.document);
    expect(store.getSnapshot().history).toEqual(before.history);
    expect(store.getSnapshot().job.status).not.toBe("running");
  });
  it("commits ordered Bend, Twist, Taper and supports update, toggle, reorder, remove and undo", async () => {
    const store = fixture();
    for (const change of [{ type: "add" as const, targetId: "target", kind: "bend" as const, parameters: bend },
      { type: "add" as const, targetId: "target", kind: "twist" as const, parameters: twist },
      { type: "add" as const, targetId: "target", kind: "taper" as const, parameters: taper }])
      expect(await applyDeformChange(store, change)).toMatchObject({ ok: true, committed: true });
    const [first, second] = store.getSnapshot().document.project.modifiers;
    expect(store.getSnapshot().document.project.modifiers.map(item => item.kind)).toEqual(["bend", "twist", "taper"]);
    expect(await applyDeformChange(store, { type: "update", targetId: "target", modifierId: first!.id, parameters: { ...bend, angleDegrees: 60 } })).toMatchObject({ ok: true, committed: true });
    const before = store.getSnapshot();
    expect(await applyDeformChange(store, { type: "update", targetId: "target", modifierId: first!.id, parameters: { ...bend, angleDegrees: 60 } })).toMatchObject({ ok: true, committed: false });
    expect(store.getSnapshot().history.entries).toHaveLength(before.history.entries.length);
    expect(await applyDeformChange(store, { type: "move", targetId: "target", modifierId: first!.id, toIndex: 2 })).toMatchObject({ ok: true, committed: true });
    expect(store.getSnapshot().document.project.nodes.find(node => node.id === "target")?.modifierIds[2]).toBe(first!.id);
    expect(await applyDeformChange(store, { type: "enable", targetId: "target", modifierId: second!.id, enabled: false })).toMatchObject({ ok: true, committed: true });
    expect(await applyDeformChange(store, { type: "remove", targetId: "target", modifierId: first!.id })).toMatchObject({ ok: true, committed: true });
    const revision = store.getSnapshot().document.revision;
    expect(store.undo(revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.modifiers.some(item => item.id === first!.id)).toBe(true);
    expect(store.redo(revision + 1).ok).toBe(true);
  });
  it("leaves document and history untouched after failed evaluation", async () => {
    const store = fixture();
    const before = store.getSnapshot();
    const dispose = vi.fn();
    const factory = () => ({ evaluate: vi.fn(async () => ({ ok: false, error: { code: "GEOMETRY_DEGENERATE", message: "Некорректная сетка." } })), dispose }) as unknown as ModifierEvaluator;
    expect((await applyDeformChange(store, { type: "add", targetId: "target", kind: "bevel", parameters: bevel }, factory)).ok).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.getSnapshot().document).toEqual(before.document);
    expect(store.getSnapshot().history).toEqual(before.history);
  });
  it("removes the last active deformation without running an evaluator", async () => {
    const store = fixture();
    expect(await applyDeformChange(store, { type: "add", targetId: "target", kind: "bend", parameters: bend })).toMatchObject({ ok: true });
    const id = store.getSnapshot().document.project.modifiers[0]!.id;
    const factory = vi.fn();
    expect(await applyDeformChange(store, { type: "remove", targetId: "target", modifierId: id }, factory)).toMatchObject({ ok: true, committed: true });
    expect(factory).not.toHaveBeenCalled();
    expect(store.getSnapshot().document.project.modifiers).toHaveLength(0);
  });
  it("blocks an asset-backed mesh without a runtime resolver", async () => {
    const project = createProject(() => crypto.randomUUID());
    const root = project.nodes[0]!;
    const node = createPrimitiveNode("cube", root.id, "target");
    node.meshSource = { kind: "asset", assetId: "asset" };
    project.assets.push({ id: "asset", hash: "hash", mediaType: "model/gltf-binary", path: "assets/model.glb", colorSpace: "none" });
    project.nodes.push(node); root.children.push(node.id);
    const store = createEditorStore(project); store.setSelection(["target"]);
    const before = store.getSnapshot();
    expect((await applyDeformChange(store, { type: "add", targetId: "target", kind: "bend", parameters: bend })).ok).toBe(false);
    expect(store.getSnapshot().document).toEqual(before.document);
  });
  it("cancels pending work and ignores late results", async () => {
    const store = fixture();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const dispose = vi.fn();
    const factory = () => ({ evaluate: async () => { await pending; return { ok: true }; }, dispose }) as unknown as ModifierEvaluator;
    const operation = applyDeformChange(store, { type: "add", targetId: "target", kind: "bevel", parameters: bevel }, factory);
    await vi.waitFor(() => expect(store.getSnapshot().job.status).toBe("running"));
    expect((await applyDeformChange(store, { type: "add", targetId: "target", kind: "twist", parameters: twist })).ok).toBe(false);
    expect(store.jobs.cancelJob()).toBe(true);
    expect(await operation).toMatchObject({ ok: false, status: "cancelled" });
    release(); await Promise.resolve();
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
