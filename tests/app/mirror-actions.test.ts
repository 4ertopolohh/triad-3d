import { describe, expect, it, vi } from "vitest";
import { applyMirrorChange } from "../../src/app/mirror-actions";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import type { ModifierEvaluator } from "../../src/geometry/modifiers";
import type { MirrorParameters } from "../../src/geometry/modifiers/types";

const parameters: MirrorParameters = { axes: "x", pivot: [0, 0, 0], mergeSeam: false };
function fixture(primitive: "cube" | "plane" = "cube") {
  const project = createProject(() => crypto.randomUUID());
  const root = project.nodes[0]!;
  const node = createPrimitiveNode(primitive, root.id, "target");
  project.nodes.push(node); root.children.push(node.id);
  return createEditorStore(project);
}
const change = (modifierId: string) => ({ type: "update" as const, targetId: "target", modifierId, parameters: { ...parameters, pivot: [1, 0, 0] as const } });

describe("Mirror user actions", () => {
  it("adds, updates, toggles, moves and removes in single undo steps", async () => {
    const store = fixture();
    expect(await applyMirrorChange(store, { type: "add", targetId: "target", parameters })).toMatchObject({ ok: true, committed: true });
    const first = store.getSnapshot().document.project.modifiers[0]!.id;
    expect(await applyMirrorChange(store, change(first))).toMatchObject({ ok: true, committed: true });
    const before = store.getSnapshot();
    expect(await applyMirrorChange(store, change(first))).toMatchObject({ ok: true, committed: false });
    expect(store.getSnapshot().document.revision).toBe(before.document.revision);
    expect(store.getSnapshot().history.entries).toHaveLength(before.history.entries.length);
    expect(await applyMirrorChange(store, { type: "add", targetId: "target", parameters })).toMatchObject({ ok: true });
    expect(await applyMirrorChange(store, { type: "move", targetId: "target", modifierId: first, toIndex: 1 })).toMatchObject({ ok: true });
    expect(store.getSnapshot().document.project.nodes.find(n => n.id === "target")?.modifierIds[1]).toBe(first);
    expect(await applyMirrorChange(store, { type: "enable", targetId: "target", modifierId: first, enabled: false })).toMatchObject({ ok: true });
    expect(await applyMirrorChange(store, { type: "remove", targetId: "target", modifierId: first })).toMatchObject({ ok: true });
    const revision = store.getSnapshot().document.revision;
    expect(store.undo(revision).ok).toBe(true);
    expect(store.getSnapshot().document.project.modifiers.some(item => item.id === first)).toBe(true);
    expect(store.redo(revision + 1).ok).toBe(true);
    expect(store.getSnapshot().document.project.modifiers.some(item => item.id === first)).toBe(false);
  });
  it("rejects invalid input and a modifier owned by another mesh without history changes", async () => {
    const store = fixture();
    const original = store.getSnapshot();
    expect((await applyMirrorChange(store, { type: "add", targetId: "target", parameters: { ...parameters, axes: "bad" as "x" } })).ok).toBe(false);
    expect(store.getSnapshot().document.revision).toBe(original.document.revision);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(await applyMirrorChange(store, { type: "add", targetId: "target", parameters })).toMatchObject({ ok: true });
    const id = store.getSnapshot().document.project.modifiers[0]!.id;
    expect((await applyMirrorChange(store, { type: "update", targetId: "other", modifierId: id, parameters })).ok).toBe(false);
  });
  it("rolls back failed geometry checks and ignores an evaluator fallback", async () => {
    const store = fixture();
    const before = store.getSnapshot();
    const dispose = vi.fn();
    const evaluatorFactory = () => ({ evaluate: vi.fn(async () => ({ ok: false, fallback: true, error: { code: "GEOMETRY_NON_MANIFOLD", message: "Открытая сетка." }, warnings: [], appliedModifierIds: [] })), dispose }) as unknown as ModifierEvaluator;
    const result = await applyMirrorChange(store, { type: "add", targetId: "target", parameters: { ...parameters, mergeSeam: true } }, evaluatorFactory);
    expect(result.ok).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.getSnapshot().document.project).toEqual(before.document.project);
    expect(store.getSnapshot().history).toEqual(before.history);
    expect(store.getSnapshot().document.dirty).toBe(before.document.dirty);
  });
  it("checks the remaining active stack before removing Mirror", async () => {
    const store = fixture();
    expect(await applyMirrorChange(store, { type: "add", targetId: "target", parameters })).toMatchObject({ ok: true });
    const mirrorId = store.getSnapshot().document.project.modifiers[0]!.id;
    const snapshot = store.getSnapshot();
    expect(store.executeCommand({ commandId: crypto.randomUUID(), type: "ADD_ARRAY_MODIFIER", targetIds: ["target", "array"],
      payload: { nodeId: "target", modifierId: "array", parameters: { mode: "linear", count: 2, axis: "x", step: 1, offset: [0, 0, 0] } } }, snapshot.document.revision).ok).toBe(true);
    const before = store.getSnapshot();
    const evaluate = vi.fn(async () => ({ ok: false, fallback: true, error: { code: "RESOURCE_TOO_LARGE", message: "Лимит." }, warnings: [], appliedModifierIds: [] }));
    const factory = () => ({ evaluate, dispose: vi.fn() }) as unknown as ModifierEvaluator;
    expect((await applyMirrorChange(store, { type: "remove", targetId: "target", modifierId: mirrorId }, factory)).ok).toBe(false);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(store.getSnapshot().document.project).toEqual(before.document.project);
    expect(store.getSnapshot().history).toEqual(before.history);
  });
  it("rejects CSG on an open plane while ordinary Mirror still works", async () => {
    const store = fixture("plane");
    expect((await applyMirrorChange(store, { type: "add", targetId: "target", parameters: { ...parameters, mergeSeam: true } })).ok).toBe(false);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
    expect(await applyMirrorChange(store, { type: "add", targetId: "target", parameters })).toMatchObject({ ok: true, committed: true });
  });
  it("cancels a pending check without a late commit", async () => {
    const store = fixture();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const evaluatorFactory = () => ({ evaluate: async () => { await pending; return { ok: true }; }, dispose: vi.fn() }) as unknown as ModifierEvaluator;
    const operation = applyMirrorChange(store, { type: "add", targetId: "target", parameters }, evaluatorFactory);
    await vi.waitFor(() => expect(store.getSnapshot().job.status).toBe("running"));
    expect(store.jobs.cancelJob()).toBe(true);
    const outcome = await operation;
    expect(outcome).toMatchObject({ ok: false, status: "cancelled" });
    release();
    await Promise.resolve();
    expect(store.getSnapshot().history.entries).toHaveLength(0);
  });
});
