import Module, { type ManifoldToplevel } from "manifold-3d";
import { BufferAttribute, BufferGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from "three";

export type Operation = "subtract" | "union" | "intersect";
export type Detail = "low" | "medium" | "high";
export type MeshData = { positions: Float32Array; indices: Uint32Array };
export type CsgErrorCode = "GEOMETRY_NON_MANIFOLD" | "GEOMETRY_DEGENERATE" | "FILE_INVALID" | "JOB_CANCELLED";
export class CsgError extends Error {
  constructor(public readonly code: CsgErrorCode, message: string) { super(message); }
}

let initialized: Promise<ManifoldToplevel> | undefined;
export function manifoldModule() {
  return initialized ??= Module().then((api) => { api.setup(); return api; });
}

export function fromThree(geometry: BufferGeometry): MeshData {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3) throw new CsgError("FILE_INVALID", "Ожидается атрибут position из трёх координат");
  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }
  const sourceIndex = geometry.getIndex();
  const indices = sourceIndex ? Uint32Array.from(sourceIndex.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
  const data = { positions, indices };
  validateMesh(data);
  return data;
}

export function toThree(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions.slice(), 3));
  geometry.setIndex(new BufferAttribute(data.indices.slice(), 1));
  geometry.computeVertexNormals();
  return geometry;
}

export function validateMesh(data: MeshData, allowEmpty = false): void {
  const { positions, indices } = data;
  if (positions.length % 3 || indices.length % 3 || (!allowEmpty && !indices.length)) throw new CsgError("FILE_INVALID", "Некорректная длина буфера сетки");
  if (positions.some((v) => !Number.isFinite(v))) throw new CsgError("FILE_INVALID", "Координаты содержат NaN или Infinity");
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
    if (a >= positions.length / 3 || b >= positions.length / 3 || c >= positions.length / 3) throw new CsgError("FILE_INVALID", "Индекс вне диапазона");
    const ax = positions[3 * b]! - positions[3 * a]!, ay = positions[3 * b + 1]! - positions[3 * a + 1]!, az = positions[3 * b + 2]! - positions[3 * a + 2]!;
    const bx = positions[3 * c]! - positions[3 * a]!, by = positions[3 * c + 1]! - positions[3 * a + 1]!, bz = positions[3 * c + 2]! - positions[3 * a + 2]!;
    const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
    if (x * x + y * y + z * z < 1e-20) throw new CsgError("GEOMETRY_DEGENERATE", `Вырожденный треугольник ${i / 3}`);
  }
}

export function makeInputs(operation: Operation, detail: Detail): [MeshData, MeshData] {
  const segments = { low: 16, medium: 32, high: 64 }[detail];
  const first = operation === "subtract"
    ? new TorusGeometry(1.4, 0.48, segments, segments * 2)
    : new SphereGeometry(1, segments * 2, segments);
  const second = operation === "subtract"
    ? new CylinderGeometry(0.27, 0.27, 1.5, segments, 1, false)
    : new SphereGeometry(1, segments * 2, segments);
  second.translate(operation === "subtract" ? 1.4 : 0.65, 0, 0);
  if (operation === "subtract") second.rotateX(Math.PI / 2);
  try { return [fromThree(first), fromThree(second)]; }
  finally { first.dispose(); second.dispose(); }
}

export async function compute(operation: Operation, first: MeshData, second: MeshData) {
  validateMesh(first); validateMesh(second);
  const api = await manifoldModule();
  const owned: InstanceType<typeof api.Manifold>[] = [];
  try {
    const importMesh = (data: MeshData) => {
      const mesh = new api.Mesh({ numProp: 3, vertProperties: data.positions.slice(), triVerts: data.indices.slice() });
      mesh.merge(); // Weld only coincident open-edge positions; no source attributes are altered.
      const solid = new api.Manifold(mesh);
      owned.push(solid);
      if (solid.status() !== "NoError" || solid.isEmpty()) throw new CsgError("GEOMETRY_NON_MANIFOLD", `Manifold input: ${solid.status()}`);
      return solid;
    };
    const a = importMesh(first), b = importMesh(second);
    const start = performance.now();
    const result = operation === "subtract" ? a.subtract(b) : operation === "union" ? a.add(b) : a.intersect(b);
    owned.push(result);
    const status = result.status();
    const computeMs = performance.now() - start;
    if (status !== "NoError") throw new CsgError("GEOMETRY_NON_MANIFOLD", `Manifold output: ${status}`);
    const mesh = result.getMesh();
    const output = { positions: new Float32Array(mesh.vertProperties), indices: new Uint32Array(mesh.triVerts) };
    validateMesh(output, result.isEmpty());
    return { output, status, computeMs, empty: result.isEmpty(), inputTriangles: (first.indices.length + second.indices.length) / 3, outputTriangles: output.indices.length / 3 };
  } catch (error) {
    if (error instanceof CsgError) throw error;
    throw new CsgError("GEOMETRY_NON_MANIFOLD", error instanceof Error ? error.message : String(error));
  } finally { for (const item of owned.reverse()) item.delete(); }
}
