import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createEditorStore } from "../../src/app/editor-store";
import { MaterialInspector } from "../../src/ui/MaterialInspector";
import { materialPresets } from "../../src/materials/presets";
import { createNestedMeshProject } from "../fixtures/projects";

describe("MaterialInspector", () => {
  it("shows current PBR values without modifying the project on render", () => {
    const project = createNestedMeshProject();
    project.materials.push({ ...structuredClone(materialPresets[0]!.material), id: "m", roughness: .123456789, baseColor: [2, .2, .3] });
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    node.materialSlots = [{ name: "Основной", materialId: "m" }];
    const store = createEditorStore(project);
    store.setSelection([node.id], node.id);
    const before = store.getSnapshot();
    const html = renderToStaticMarkup(createElement(MaterialInspector, { store, state: before }));
    expect(html).toContain("Шероховатость");
    expect(html).toContain("0.123456789");
    expect(html).toContain("HDR-компоненты");
    expect(html).toContain("Проекция текстуры");
    expect(html).toContain("Плоскость");
    expect(store.getSnapshot()).toBe(before);
  });
  it("shows planar controls from the domain material", () => {
    const project = createNestedMeshProject();
    project.materials.push({ ...structuredClone(materialPresets[0]!.material), id: "m", textureMappings: { baseColor: { mode: "planar", axis: "y", tiling: [2, 3], offset: [4, -5] } } });
    const node = project.nodes.find(item => item.id === "mesh-node")!;
    node.materialSlots = [{ name: "Основной", materialId: "m" }];
    const store = createEditorStore(project); store.setSelection([node.id], node.id);
    const html = renderToStaticMarkup(createElement(MaterialInspector, { store, state: store.getSnapshot() }));
    for (const label of ["Ось проекции", "Повторение U", "Повторение V", "Смещение U", "Смещение V"]) expect(html).toContain(label);
    expect(html).toContain('value="2"');
  });
});
