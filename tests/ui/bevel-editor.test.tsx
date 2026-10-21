import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject } from "../../src/domain/create-project";
import { createPrimitiveNode } from "../../src/geometry/primitives";
import { createEditorStore } from "../../src/app/editor-store";
import { BooleanEditor } from "../../src/ui/BooleanEditor";

describe("Bevel Inspector", () => {
  it("renders Bevel in the shared stack with the effective 30° threshold", () => {
    const project = createProject(() => crypto.randomUUID());
    const root = project.nodes[0]!;
    const node = createPrimitiveNode("cube", root.id, "cube");
    root.children.push(node.id);
    node.modifierIds.push("bevel");
    project.nodes.push(node);
    project.modifiers.push({ id: "bevel", nodeId: node.id, kind: "bevel", parameters: { width: 0.1 }, enabled: true, order: 0, version: 0 });
    const store = createEditorStore(project);
    store.setSelection([node.id]);
    const snapshot = store.getSnapshot();
    const target = snapshot.document.project.nodes.find(item => item.id === node.id);
    if (!target || target.kind !== "mesh") throw new Error("Missing mesh");
    const html = renderToStaticMarkup(<BooleanEditor store={store} project={snapshot.document.project} target={target} disabled={false} reason="" />);
    expect(html).toContain("Фаска (Bevel)");
    expect(html).toContain("Ширина фаски");
    expect(html).toContain('value="30"');
    expect(html).toContain("1. Фаска (Bevel)");
  });
});
