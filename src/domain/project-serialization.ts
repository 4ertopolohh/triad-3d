import Ajv2020 from "ajv/dist/2020.js";
import documentSchema from "./schemas/document-v1.2.schema.json";
import previousDocumentSchema from "./schemas/document-v1.1.schema.json";
import oldDocumentSchema from "./schemas/document-v1.schema.json";
import manifestSchema from "./schemas/manifest-v1.schema.json";
import type { Project } from "./types";
import { validateProject } from "./validate-project";

export const DOCUMENT_SCHEMA_VERSION = "1.2.0";
export const NATIVE_FORMAT_VERSION = "1.0.0";
export const SERIALIZATION_LIMITS = { maxJsonBytes: 16 * 1024 * 1024, maxDepth: 64, maxValues: 250_000 } as const;

export type SerializationErrorCode = "FILE_INVALID" | "SCHEMA_UNSUPPORTED";
export interface SerializationError {
  code: SerializationErrorCode;
  message: string;
  path?: string;
  details?: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: SerializationError };

export interface NativeManifest {
  formatVersion: string;
  appVersion: string;
  document: { path: "document.json"; sha256: string };
  assets: { id: string; path: string; sha256: string }[];
}

export interface DocumentMigration {
  readonly from: string;
  readonly to: string;
  migrate(input: unknown): unknown;
}

const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false, removeAdditional: false, useDefaults: false });
const documentValidator = ajv.compile(documentSchema);
const previousDocumentValidator = ajv.compile(previousDocumentSchema);
const oldDocumentValidator = ajv.compile(oldDocumentSchema);
const manifestValidator = ajv.compile(manifestSchema);
const fail = (code: SerializationErrorCode, message: string, path?: string, details?: string): Result<never> => ({
  ok: false, error: { code, message, ...(path === undefined ? {} : { path }), ...(details === undefined ? {} : { details }) },
});

function schemaError(errors: typeof documentValidator.errors): Result<never> {
  const first = errors?.[0];
  const path = first?.keyword === "required" && typeof first.params.missingProperty === "string"
    ? `${first.instancePath}/${first.params.missingProperty}`
    : first?.keyword === "additionalProperties" && typeof first.params.additionalProperty === "string"
      ? `${first.instancePath}/${first.params.additionalProperty}` : first?.instancePath;
  return fail("FILE_INVALID", "Структура документа не соответствует схеме.", path || "/", first?.message);
}

function inspect(value: unknown): Result<true> {
  const active = new WeakSet<object>();
  const stack: { value: unknown; depth: number; path: string; exit?: boolean }[] = [{ value, depth: 0, path: "/" }];
  let count = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item) break;
    if (item.exit) {
      active.delete(item.value as object);
      continue;
    }
    if (++count > SERIALIZATION_LIMITS.maxValues) return fail("FILE_INVALID", "Превышен лимит элементов документа.", item.path);
    if (item.depth > SERIALIZATION_LIMITS.maxDepth) return fail("FILE_INVALID", "Превышена глубина документа.", item.path);
    if (typeof item.value === "number" && !Number.isFinite(item.value)) return fail("FILE_INVALID", "Число должно быть конечным.", item.path);
    if (item.value && typeof item.value === "object") {
      if (active.has(item.value)) return fail("FILE_INVALID", "Цикл в документе.", item.path);
      active.add(item.value);
      stack.push({ ...item, exit: true });
      for (const key of Object.keys(item.value)) {
        stack.push({ value: (item.value as Record<string, unknown>)[key], depth: item.depth + 1, path: `${item.path === "/" ? "" : item.path}/${key}` });
      }
    }
  }
  return { ok: true, value: true };
}

function isProject(value: unknown): value is Project {
  return documentValidator(value);
}

function isNativeManifest(value: unknown): value is NativeManifest {
  return manifestValidator(value);
}

function validateDocument(value: unknown): Result<Project> {
  const safety = inspect(value);
  if (!safety.ok) return safety;
  if (!isProject(value)) return schemaError(documentValidator.errors);
  const issues = validateProject(value);
  if (issues.length) {
    const issue = issues[0];
    return fail("FILE_INVALID", "Нарушена целостность проекта.", issue?.path, issue?.code);
  }
  return { ok: true, value };
}

function versionOf(value: unknown): Result<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("FILE_INVALID", "Ожидается объект проекта.", "/");
  const version = (value as Record<string, unknown>).schemaVersion;
  if (typeof version !== "string") return fail("FILE_INVALID", "Не указана версия документа.", "/schemaVersion");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return fail("SCHEMA_UNSUPPORTED", "Неверный формат версии документа.", "/schemaVersion");
  return { ok: true, value: version };
}

const builtinMigrations: readonly DocumentMigration[] = [{ from: "1.0.0", to: "1.1.0", migrate(input) {
  if (!oldDocumentValidator(input)) throw new Error("Invalid v1 document");
  return { ...(input as Record<string, unknown>), schemaVersion: "1.1.0" };
} }, { from: "1.1.0", to: "1.2.0", migrate(input) {
  if (!previousDocumentValidator(input)) throw new Error("Invalid v1.1 document");
  return { ...(input as Record<string, unknown>), schemaVersion: "1.2.0" };
} }];

export function migrateProjectDocument(value: unknown, migrations: readonly DocumentMigration[] = []): Result<unknown> {
  const initial = versionOf(value);
  if (!initial.ok) return initial;
  let version = initial.value;
  let current = value;
  const visited = new Set<string>();
  while (version !== DOCUMENT_SCHEMA_VERSION) {
    if (visited.has(version) || visited.size >= 32) return fail("SCHEMA_UNSUPPORTED", "Цикл или слишком длинная цепочка миграций.", "/schemaVersion");
    visited.add(version);
    const migration = [...migrations, ...builtinMigrations].find((entry) => entry.from === version);
    if (!migration) return fail("SCHEMA_UNSUPPORTED", `Версия документа ${version} не поддерживается.`, "/schemaVersion");
    try {
      // Migration code is trusted application code; each step receives an isolated copy.
      current = migration.migrate(JSON.parse(JSON.stringify(current)));
    } catch {
      return fail("FILE_INVALID", "Миграция документа завершилась ошибкой.", "/schemaVersion");
    }
    const next = versionOf(current);
    if (!next.ok) return next;
    if (next.value !== migration.to) return fail("FILE_INVALID", "Миграция вернула неожиданную версию.", "/schemaVersion");
    version = next.value;
  }
  return { ok: true, value: current };
}

export function serializeProjectDocument(project: Project): Result<string> {
  try {
    const version = versionOf(project);
    if (!version.ok) return version;
    if (version.value !== DOCUMENT_SCHEMA_VERSION) return fail("SCHEMA_UNSUPPORTED", `Версия документа ${version.value} не поддерживается.`, "/schemaVersion");
    const checked = validateDocument(project);
    if (!checked.ok) return checked;
    const json = JSON.stringify(project);
    if (new TextEncoder().encode(json).byteLength > SERIALIZATION_LIMITS.maxJsonBytes) return fail("FILE_INVALID", "Превышен лимит размера документа.");
    return { ok: true, value: json };
  } catch {
    return fail("FILE_INVALID", "Не удалось сериализовать документ.");
  }
}

export function deserializeProjectDocument(json: string, migrations: readonly DocumentMigration[] = []): Result<Project> {
  if (typeof json !== "string") return fail("FILE_INVALID", "Ожидается JSON-строка.");
  if (new TextEncoder().encode(json).byteLength > SERIALIZATION_LIMITS.maxJsonBytes) return fail("FILE_INVALID", "Превышен лимит размера документа.");
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail("FILE_INVALID", "Некорректный JSON."); }
  const safety = inspect(parsed);
  if (!safety.ok) return safety;
  const migrated = migrateProjectDocument(parsed, migrations);
  if (!migrated.ok) return migrated;
  const checked = validateDocument(migrated.value);
  if (!checked.ok) return checked;
  // A parsed JSON tree is already independent; migrations are checked again above.
  return checked;
}

function safeArchivePath(path: string): boolean {
  return path.length > 0 && path.length <= 1024 && !/[\\:%]/.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    !path.startsWith("/") && !path.endsWith("/") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

export function validateNativeManifest(value: unknown): Result<NativeManifest> {
  try {
    const safety = inspect(value);
    if (!safety.ok) return safety;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail("FILE_INVALID", "Ожидается объект manifest.");
    const version = (value as Record<string, unknown>).formatVersion;
    if (typeof version !== "string") return fail("FILE_INVALID", "Не указана версия manifest.", "/formatVersion");
    if (version !== NATIVE_FORMAT_VERSION) return fail("SCHEMA_UNSUPPORTED", `Версия контейнера ${version} не поддерживается.`, "/formatVersion");
    if (!isNativeManifest(value)) return schemaError(manifestValidator.errors);
    const manifest = value;
    const paths = new Set<string>([manifest.document.path.toLowerCase()]);
    const ids = new Set<string>();
    for (const [index, asset] of manifest.assets.entries()) {
      if (!safeArchivePath(asset.path)) return fail("FILE_INVALID", "Недопустимый путь ресурса.", `/assets/${index}/path`);
      const folded = asset.path.toLowerCase();
      if (paths.has(folded)) return fail("FILE_INVALID", "Пути в manifest конфликтуют.", `/assets/${index}/path`);
      if (ids.has(asset.id)) return fail("FILE_INVALID", "ID ресурса повторяется.", `/assets/${index}/id`);
      paths.add(folded);
      ids.add(asset.id);
    }
    return { ok: true, value: manifest };
  } catch {
    return fail("FILE_INVALID", "Не удалось проверить manifest.");
  }
}
