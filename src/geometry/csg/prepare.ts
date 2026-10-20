import { Matrix4, Vector3 } from "three";
import { validateMesh } from "./core";
import { CsgError, type CsgOperand, type CsgRequest, type CsgWarning, type MeshData } from "./types";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function matrix(values?: readonly number[]): Matrix4 {
  const elements = values ?? identity;
  if (elements.length !== 16 || elements.some((n) => !Number.isFinite(n))) throw new CsgError("FILE_INVALID", "Некорректная матрица преобразования CSG");
  const result = new Matrix4().fromArray(elements);
  const det = result.determinant();
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new CsgError("GEOMETRY_DEGENERATE", "Вырожденная матрица преобразования CSG");
  // Projective transforms are not supported by the solid mesh contract.
  if (Math.abs(elements[3]!) > 1e-10 || Math.abs(elements[7]!) > 1e-10 || Math.abs(elements[11]!) > 1e-10 || Math.abs(elements[15]! - 1) > 1e-10)
    throw new CsgError("FILE_INVALID", "Проективное преобразование CSG не поддерживается");
  return result;
}

function transformed(source: MeshData, transform: Matrix4): MeshData {
  const positions = source.positions.slice();
  const indices = source.indices.slice();
  const point = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i]!, positions[i + 1]!, positions[i + 2]!).applyMatrix4(transform);
    positions[i] = point.x; positions[i + 1] = point.y; positions[i + 2] = point.z;
  }
  if (transform.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
  const output = { positions, indices };
  validateMesh(output);
  return output;
}

function warnings(operands: CsgOperand[]): CsgWarning[] {
  const result: CsgWarning[] = [];
  if (operands.some((o) => o.attributes?.uv)) result.push({ code: "UV_DROPPED", message: "Исходные UV не переносятся на CSG-результат" });
  if (operands.some((o) => o.attributes?.normals)) result.push({ code: "NORMALS_RECOMPUTED", message: "Авторские нормали не сохраняются; отображение может пересчитать их" });
  if (operands.some((o) => o.attributes?.materialGroups || (o.attributes?.materialSlots ?? 0) > 1)) result.push({ code: "MATERIALS_DROPPED", message: "Группы и слоты материалов не сохраняются" });
  return result;
}

export function prepareCsgRequest(request: CsgRequest) {
  if (!request.jobId || !["subtract", "union", "intersect"].includes(request.operation)) throw new CsgError("FILE_INVALID", "Некорректное задание CSG");
  validateMesh(request.target.mesh); validateMesh(request.cutter.mesh);
  const targetWorld = matrix(request.target.worldMatrix);
  const cutterWorld = matrix(request.cutter.worldMatrix);
  const relative = targetWorld.clone().invert().multiply(cutterWorld);
  if (!Number.isFinite(relative.determinant()) || Math.abs(relative.determinant()) < 1e-12) throw new CsgError("GEOMETRY_DEGENERATE", "Недопустимое относительное преобразование CSG");
  return { jobId: request.jobId, operation: request.operation, first: { positions: request.target.mesh.positions.slice(), indices: request.target.mesh.indices.slice() }, second: transformed(request.cutter.mesh, relative), warnings: warnings([request.target, request.cutter]) };
}
