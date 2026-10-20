import { describe, expect, it } from "vitest";
import { convertPrimitiveToEditable } from "../../src/geometry/mesh-edit";
import { buildMeshTopology, selectedTopologyVertices } from "../../src/geometry/mesh-topology";
import { createNestedMeshProject } from "../fixtures/projects";

const cube = () => {
  const node = createNestedMeshProject().nodes.find(item => item.id === "mesh-node");
  if (node?.kind !== "mesh" || node.meshSource.kind !== "primitive") throw new Error("cube fixture");
  return convertPrimitiveToEditable(node.meshSource);
};

describe("editable mesh topology", () => {
  it("groups the cube into six UV seam aware faces and deduplicates geometric edges", () => {
    const source = cube();
    const before = structuredClone(source);
    const topology = buildMeshTopology(source)!;
    expect(topology.faces).toHaveLength(6);
    expect(topology.faces.every(face => face.triangles.length === 2)).toBe(true);
    expect(topology.edges).toHaveLength(18); // Twelve outer edges and six triangulation diagonals.
    expect(topology.edges.every(edge => edge.vertices[0] !== edge.vertices[1])).toBe(true);
    expect(buildMeshTopology(source)).toEqual(topology);
    expect(source).toEqual(before);
  });

  it("keeps disconnected coplanar triangles separate and rejects bent joins", () => {
    const source = { kind: "editable" as const, positions: [0,0,0, 1,0,0, 0,1,0, 3,0,0, 4,0,0, 3,1,0], indices: [0,1,2,3,4,5] };
    expect(buildMeshTopology(source)?.faces).toHaveLength(2);
    const bent = { kind: "editable" as const, positions: [0,0,0, 1,0,0, 0,1,0, 1,1,0.01], indices: [0,1,2, 1,3,2] };
    expect(buildMeshTopology(bent)?.faces).toHaveLength(2);
  });

  it("rejects bad indices and returns unique vertices for multi selection", () => {
    expect(buildMeshTopology({ kind: "editable", positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,4] })).toBeNull();
    const topology = buildMeshTopology(cube())!;
    const ids = topology.edges.slice(0, 2).map(edge => edge.id);
    const vertices = selectedTopologyVertices(topology, "edge", ids)!;
    expect(vertices).toEqual([...new Set(vertices)]);
    expect(selectedTopologyVertices(topology, "face", [999])).toBeNull();
  });
});
