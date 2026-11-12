import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createEditorStore } from "../../src/app/editor-store";
import { createProject } from "../../src/domain/create-project";
import { SceneInspector } from "../../src/ui/SceneInspector";

describe("scene inspector", () => {
  it("preserves precise document numbers in editable fields and does not mutate on render", () => {
    const project = createProject(); project.scene.camera.position = [1.234567891, 2, 3];
    const store = createEditorStore(project); store.setTool({ mode: "scene" });
    const before = store.captureDocument();
    const html = renderToStaticMarkup(createElement(SceneInspector, { store, state: store.getSnapshot(), blocked: false }));
    expect(html).toContain('value="1.234567891"');
    expect(html).not.toContain('value="1.2345679"');
    expect(store.captureDocument()).toEqual(before);
    expect(store.getSnapshot().history.entries).toHaveLength(0);
  });
});
