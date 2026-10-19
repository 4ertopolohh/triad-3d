import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BufferGeometry, Material, Mesh, Object3D } from "three";
import { ARCHIVE_LIMITS } from "../../assets/native-project-archive";
import type { EditorStore } from "../../app/editor-store";
import type { CommandResult, ProjectCommand } from "../../domain/command-bus";
import type { Asset, MeshNode } from "../../domain/types";

export type ImportResult<T> = { ok: true; value: T } | { ok: false; error: { code: "FILE_INVALID" | "IMPORT_UNSUPPORTED" | "ASSET_DECODE_FAILED"; message: string } };
const fail = (code: "FILE_INVALID" | "IMPORT_UNSUPPORTED" | "ASSET_DECODE_FAILED", message: string): ImportResult<never> => ({ ok: false, error: { code, message } });
const decoder = new TextDecoder("utf-8", { fatal: true });
const maxEntities = 10000;

export interface PreparedGlb {
  name: string;
  bytes: Uint8Array;
  hash: string;
  triangles: number;
  materialCount: number;
}

function inspectContainer(bytes: Uint8Array): ImportResult<Record<string, unknown>> {
  if (bytes.byteLength < 20 || bytes.byteLength > ARCHIVE_LIMITS.asset) return fail("FILE_INVALID", "Размер GLB недопустим (максимум 64 МиБ).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return fail("FILE_INVALID", "Файл не содержит сигнатуру GLB.");
  if (view.getUint32(4, true) !== 2) return fail("IMPORT_UNSUPPORTED", "Поддерживается только GLB версии 2.");
  if (view.getUint32(8, true) !== bytes.byteLength) return fail("FILE_INVALID", "Длина GLB не совпадает с размером файла.");
  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let binLength = 0;
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) return fail("FILE_INVALID", "Повреждён заголовок chunk GLB.");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 !== 0 || length > bytes.byteLength - offset) return fail("FILE_INVALID", "Повреждены границы chunk GLB.");
    if (chunkIndex === 0 && type === 0x4e4f534a) {
      try {
        const parsed: unknown = JSON.parse(decoder.decode(bytes.subarray(offset, offset + length)).trimEnd());
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail("FILE_INVALID", "JSON chunk должен быть объектом.");
        json = parsed as Record<string, unknown>;
      } catch { return fail("FILE_INVALID", "Некорректный JSON chunk GLB."); }
    } else if (chunkIndex === 1 && type === 0x004e4942) binLength = length;
    else return fail("IMPORT_UNSUPPORTED", "Неподдерживаемый порядок или тип chunk GLB.");
    offset += length;
    chunkIndex += 1;
  }
  if (!json || offset !== bytes.byteLength || !binLength) return fail("FILE_INVALID", "GLB должен содержать JSON и встроенный BIN chunk.");
  const obj = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!obj(json.asset) || json.asset.version !== "2.0") return fail("IMPORT_UNSUPPORTED", "Требуется glTF 2.0.");
  if (Array.isArray(json.extensionsUsed) && json.extensionsUsed.length || Array.isArray(json.extensionsRequired) && json.extensionsRequired.length)
    return fail("IMPORT_UNSUPPORTED", "Расширения glTF пока не поддерживаются, включая обязательные декодеры.");
  const arrays = ["nodes", "meshes", "buffers", "bufferViews", "accessors", "materials", "textures", "images", "animations", "skins", "cameras", "scenes"];
  for (const key of arrays) if (json[key] !== undefined && (!Array.isArray(json[key]) || json[key].length > maxEntities)) return fail("FILE_INVALID", `Недопустимое количество элементов ${key}.`);
  // No URI, including a data URI, is handed to GLTFLoader. Embedded BIN and bufferView images are the supported path.
  const pending: unknown[] = [json];
  let visited = 0;
  while (pending.length) {
    const value = pending.pop();
    if (++visited > 100_000) return fail("FILE_INVALID", "Слишком сложная структура glTF.");
    if (Array.isArray(value)) pending.push(...value);
    else if (obj(value)) {
      if (Object.hasOwn(value, "uri")) return fail("IMPORT_UNSUPPORTED", "Внешние URI и data URI пока запрещены.");
      if (Object.hasOwn(value, "extensions")) return fail("IMPORT_UNSUPPORTED", "Расширения glTF пока не поддерживаются.");
      pending.push(...Object.values(value));
    }
  }
  if ((json.animations as unknown[] | undefined)?.length || (json.skins as unknown[] | undefined)?.length || (json.cameras as unknown[] | undefined)?.length)
    return fail("IMPORT_UNSUPPORTED", "Анимации, skinning и камеры пока не импортируются.");
  const meshes = json.meshes as unknown[] | undefined;
  const nodes = json.nodes as unknown[] | undefined;
  if (!Array.isArray(json.scenes) || json.scenes.length !== 1 || json.scene !== 0)
    return fail("IMPORT_UNSUPPORTED", "Поддерживается одна активная сцена glTF.");
  if (!meshes || meshes.length !== 1 || !nodes || nodes.filter((node) => obj(node) && node.mesh !== undefined).length !== 1)
    return fail("IMPORT_UNSUPPORTED", "Поддерживается одна статическая mesh-модель без нескольких mesh-узлов.");
  if (nodes.some((node) => !obj(node) || node.skin !== undefined || node.weights !== undefined || node.extensions !== undefined))
    return fail("IMPORT_UNSUPPORTED", "Неподдерживаемый узел glTF.");
  if (meshes.some((mesh) => !obj(mesh) || mesh.weights !== undefined || !Array.isArray(mesh.primitives)
    || mesh.primitives.length === 0 || mesh.primitives.length > 64 || mesh.primitives.some((primitive: unknown) =>
      !obj(primitive) || primitive.targets !== undefined || primitive.extensions !== undefined || (primitive.mode !== undefined && primitive.mode !== 4))))
    return fail("IMPORT_UNSUPPORTED", "Нужна статическая triangle geometry без morph targets.");
  const buffers = json.buffers as unknown[] | undefined;
  if (!buffers || buffers.length !== 1 || !obj(buffers[0]) || buffers[0].uri !== undefined
    || typeof buffers[0].byteLength !== "number" || buffers[0].byteLength > binLength || buffers[0].byteLength < binLength - 3)
    return fail("IMPORT_UNSUPPORTED", "Внешние buffers запрещены; нужен встроенный BIN chunk.");
  for (const key of ["images", "textures"] as const) {
    const entries = json[key] as unknown[] | undefined;
    if (entries?.some((entry) => !obj(entry) || entry.uri !== undefined || entry.extensions !== undefined))
      return fail("IMPORT_UNSUPPORTED", "Внешние изображения и текстуры либо их расширения запрещены.");
  }
  if (json.extensions !== undefined) return fail("IMPORT_UNSUPPORTED", "Расширения сцены пока не поддерживаются.");
  return { ok: true, value: json };
}

function dispose(root: Object3D): void {
  root.traverse((object) => {
    if (!("isMesh" in object)) return;
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = material as Material & Record<string, unknown>;
      for (const value of Object.values(mat)) if (value && typeof value === "object" && "isTexture" in value && "dispose" in value && typeof value.dispose === "function") value.dispose();
      mat.dispose();
    }
  });
}

export async function prepareGlb(file: File): Promise<ImportResult<PreparedGlb>> {
  if (!/\.glb$/i.test(file.name) || !["", "model/gltf-binary", "application/octet-stream"].includes(file.type))
    return fail("FILE_INVALID", "Выберите локальный файл .glb с допустимым MIME-типом.");
  if (file.size > ARCHIVE_LIMITS.asset) return fail("FILE_INVALID", "GLB превышает 64 МиБ.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preflight = inspectContainer(bytes);
    if (!preflight.ok) return preflight;
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(bytes.buffer as ArrayBuffer, "");
    try {
      if (gltf.animations.length) return fail("IMPORT_UNSUPPORTED", "Анимации glTF пока не переносятся в таймлайн.");
      let meshCount = 0;
      let triangles = 0;
      const materials = new Set<Material>();
      let invalid = false;
      gltf.scene.traverse((object) => {
        if ("isSkinnedMesh" in object || "isPoints" in object || "isLine" in object) invalid = true;
        if (!("isMesh" in object)) return;
        meshCount += 1;
        const mesh = object as Mesh;
        const geometry = mesh.geometry as BufferGeometry;
        const position = geometry.getAttribute("position");
        const count = geometry.index?.count ?? position?.count ?? 0;
        if (!position || position.itemSize !== 3 || !count || count % 3 !== 0 || !mesh.matrixWorld.elements.every(Number.isFinite)) invalid = true;
        if (position) for (let index = 0; index < position.count; index += 1) {
          if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) { invalid = true; break; }
        }
        triangles += count / 3;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      });
      if (invalid || meshCount < 1 || triangles < 1 || triangles > 2_000_000)
        return fail("IMPORT_UNSUPPORTED", "Геометрия пуста, повреждена или превышает лимит треугольников.");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
      return { ok: true, value: { name: file.name.slice(0, -4).slice(0, 100) || "Импорт GLB", bytes, hash, triangles, materialCount: materials.size } };
    } finally { dispose(gltf.scene); }
  } catch { return fail("ASSET_DECODE_FAILED", "Не удалось разобрать геометрию GLB."); }
}

export function commitGlb(store: EditorStore, prepared: PreparedGlb, expectedRevision: number, expectedIdentity: object): CommandResult {
  const project = store.getSnapshot().document.project;
  const existing = project.assets.find((asset) => asset.hash === prepared.hash && asset.mediaType === "model/gltf-binary");
  const assetId = existing?.id ?? crypto.randomUUID();
  const nodeId = crypto.randomUUID();
  const asset: Asset | null = existing ? null : { id: assetId, hash: prepared.hash, mediaType: "model/gltf-binary", path: `assets/${prepared.hash}.glb`, colorSpace: "none" };
  const parentId = project.model.rootNodeId;
  const node: MeshNode = { id: nodeId, kind: "mesh", name: prepared.name, parentId, children: [],
    transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
    visible: true, locked: false, materialSlots: [], modifierIds: [], meshSource: { kind: "asset", assetId } };
  const command: Extract<ProjectCommand, { type: "ADD_MESH_ASSET" }> = {
    commandId: crypto.randomUUID(), type: "ADD_MESH_ASSET", targetIds: [parentId, nodeId, assetId], payload: { parentId, node, asset },
  };
  return store.addMeshAsset(command, prepared.bytes, expectedRevision, expectedIdentity);
}
