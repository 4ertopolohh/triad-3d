import { singleFileExport } from "./single-file";
import * as T from "three";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import type { Project } from "../domain/types";
import { validateProject } from "../domain/validate-project";
import { primitiveGeometry } from "../geometry/primitive-geometry";
import { editableGeometry } from "../geometry/mesh-edit";
import { ModifierEvaluator } from "../geometry/modifiers/evaluator";
import { boxGeometry, materialProjectionGeometry, ProjectionGeometry } from "../renderer/planar-projection";
import type { ExportGeometry, ExportProfile, RuntimeBundle, ExportParameter } from "./export-types";
import runtimeSource from "./runtime.tsx?raw";
import exportTypes from "./export-types.ts?raw";
import domainTypes from "../domain/types.ts?raw";
import timelineSource from "../animation/timeline.ts?raw";
import { inspectStaticGlb } from "../importers/gltf/import-glb";
import reactLicense from "../../node_modules/react/LICENSE?raw";
import threeLicense from "../../node_modules/three/LICENSE?raw";

const rendererSources = import.meta.glob<string>("../renderer/{pbr-material,triplanar-material,base-color-textures,surface-textures,procedural-roughness-textures}.ts", { query: "?raw", import: "default", eager: true });
const proceduralSources = import.meta.glob<string>("../materials/procedural/*.ts", { query: "?raw", import: "default", eager: true });
const encode = (text: string) => new TextEncoder().encode(text);
const json = (value: unknown) => JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
export interface PreparedExport { files: Map<string,Uint8Array>; diagnostics: string[]; triangles: number; bytes: number; bundle: RuntimeBundle }

export async function prepareExport(project: Project, readAsset: (id: string) => Uint8Array | undefined, profile: ExportProfile, signal?: AbortSignal, progress: (value: number) => void = () => {}, parameters: ExportParameter[] = []): Promise<PreparedExport> {
  const issues = validateProject(project);
  if (issues.length) throw new Error(issues.map(i => i.message).join("; "));
  if (!["max","balanced","lite"].includes(profile)) throw new Error("Неизвестный профиль экспорта.");
  if (project.scene.instances.length) throw new Error("Экспорт экземпляров сцены ещё не поддерживается.");
  const parameterNames = new Set<string>();
  for (const parameter of parameters) {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(parameter.name) || ["width","height","speed","scale","color","playing","clipId","time","assetBaseUrl","onError","nodeOverrides","data","key","ref","constructor","prototype"].includes(parameter.name)
      || parameterNames.has(parameter.name) || !project.nodes.some(n => n.id === parameter.nodeId)
      || !(parameter.property === "scale" && typeof parameter.defaultValue === "number" && Number.isFinite(parameter.defaultValue) && parameter.defaultValue > 0
        || parameter.property === "color" && typeof parameter.defaultValue === "string" && /^#[0-9a-f]{6}$/i.test(parameter.defaultValue))) throw new Error("Некорректный или повторяющийся экспортный prop.");
    parameterNames.add(parameter.name);
  }
  const files = new Map<string,Uint8Array>();
  const diagnostics: string[] = [];
  if (project.animations.length && project.modifiers.some(m => m.enabled && m.kind === "boolean")) diagnostics.push("Boolean фиксируется при экспорте: анимация резака не пересчитывает результат CSG.");
  const geometries: Record<string,ExportGeometry> = Object.create(null);
  let triangles = 0;
  const check = () => { signal?.throwIfAborted(); };
  const evaluator = new ModifierEvaluator();
  try {
    for (const [index,node] of project.nodes.entries()) {
      check();
      if (node.kind === "mesh") {
        let geometry: T.BufferGeometry | undefined;
        try {
          if (node.modifierIds.some(id => project.modifiers.find(m => m.id === id)?.enabled)) {
            const result = await evaluator.evaluate(project,node.id,signal);
            if (!result.ok) throw new Error(`${node.name}: ${result.error.message}`);
            geometry = new T.BufferGeometry(); geometry.setAttribute("position",new T.BufferAttribute(result.mesh.positions,3)); geometry.setIndex(new T.BufferAttribute(result.mesh.indices,1)); geometry.computeVertexNormals();
            diagnostics.push(...result.warnings.map(w => `${node.name}: ${w.message}`));
          } else if (node.meshSource.kind === "primitive") geometry = primitiveGeometry(node.meshSource);
          else if (node.meshSource.kind === "editable") geometry = editableGeometry(node.meshSource);
          if (geometry) {
            const material = project.materials.find(m => m.id === node.materialSlots[0]?.materialId);
            const projection = material?.textureMappings?.baseColor;
            if (node.materialSlots.length > 1 && geometry.groups.length) { const previous = geometry; geometry = materialProjectionGeometry(previous,node.materialSlots.map(slot => project.materials.find(m => m.id === slot.materialId)?.textureMappings?.baseColor)); previous.dispose(); }
            else if (projection?.mode === "box") { const previous = geometry; geometry = boxGeometry(previous,projection); previous.dispose(); }
            else new ProjectionGeometry().apply(geometry,projection);
            const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv"), colors = geometry.getAttribute("color");
            const indices = geometry.getIndex(); triangles += (indices?.count ?? position.count)/3;
            if (!uv && material && (material.proceduralMaps || Object.keys(material.textureSlots ?? {}).some(k => k !== "baseColor"))) diagnostics.push(`${node.name}: карты поверхности без UV не отображаются, как и в редакторе.`);
            geometries[node.id] = { positions: Array.from(position.array), indices: indices ? Array.from(indices.array) : null, ...(normal ? { normals: Array.from(normal.array) } : {}), ...(uv ? { uv: Array.from(uv.array) } : {}), ...(colors ? {colors:Array.from(colors.array)} : {}), ...(geometry.userData.missingUvSlots ? {missingUvSlots:geometry.userData.missingUvSlots as number[]} : {}), groups: geometry.groups.map(g => ({ ...g })) };
          }
        } finally { geometry?.dispose(); }
      }
      progress((index+1)/(project.nodes.length+project.assets.length+1));
      await new Promise(resolve => setTimeout(resolve,0));
    }
  } finally { evaluator.dispose(); }
  for (const asset of project.assets) {
    check();
    if (!/^assets\/[a-f0-9]{64}\.(png|jpe?g|webp|hdr|exr|glb|bin)$/.test(asset.path)) throw new Error("Небезопасный путь ресурса.");
    const bytes = readAsset(asset.id); if (!bytes) throw new Error(`Ресурс ${asset.id} отсутствует в памяти.`);
    if (asset.mediaType === "model/gltf-binary") { const checked = inspectStaticGlb(bytes); if (!checked.ok) throw new Error(checked.error.message); }
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as BufferSource))].map(n => n.toString(16).padStart(2,"0")).join("");
    if (!asset.path.startsWith(`assets/${hash}.`)) throw new Error("Имя ресурса не соответствует контрольной сумме.");
    if (hash !== asset.hash) throw new Error(`Контрольная сумма ${asset.id} не совпадает.`);
    files.set(`public/${asset.path}`,bytes.slice());
  }
  check();
  const bundle: RuntimeBundle = { project: structuredClone(project), geometries, profile };
  const add = (path: string, source: string) => files.set(path,encode(source));
  add("src/model.json",json(bundle));
  const single = singleFileExport(bundle);
  if (single.code) add("src/StandaloneModel.tsx",single.code);
  add("licenses/React-MIT.txt",reactLicense);
  add("licenses/Three-MIT.txt",threeLicense);
  add("src/exporters/runtime.tsx",runtimeSource);
  add("src/exporters/export-types.ts",exportTypes);
  add("src/domain/types.ts",`${domainTypes}\nexport type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;\n`);
  add("src/animation/timeline.ts",timelineSource.replace('"../app/editor-store"','"../domain/types"'));
  for (const [path,source] of Object.entries({ ...rendererSources,...proceduralSources })) add(`src/${path.slice(3)}`,source.replace('"../app/editor-store"','"../domain/types"'));
  const overrides: Record<string,Record<string,string>> = Object.create(null);
  for (const p of parameters) (overrides[p.nodeId] ??= {})[p.property] = `props.${p.name} ?? ${json(p.defaultValue)}`;
  const overrideCode = `{${Object.entries(overrides).map(([id,values]) => `[${json(id)}]:{${Object.entries(values).map(([key,value]) => `${key}:${value}`).join(",")}}`).join(",")}}`;
  add("src/TriadModel.tsx",`import data from "./model.json";\nimport { TriadRuntime, type TriadModelProps } from "./exporters/runtime";\nimport type { RuntimeBundle } from "./exporters/export-types";\nexport interface Props extends Omit<TriadModelProps,"nodeOverrides"> { ${parameters.map(p => `${p.name}?: ${p.property === "scale" ? "number" : "string"};`).join(" ")} }\nexport default function TriadModel(props: Props) { return <TriadRuntime {...props} nodeOverrides={${overrideCode}} data={data as unknown as RuntimeBundle} />; }\n`);
  add("props.json",json(parameters));
  add("src/main.tsx",'import { createRoot } from "react-dom/client";\nimport TriadModel from "./TriadModel";\ncreateRoot(document.getElementById("root")!).render(<TriadModel />);\n');
  add("index.html",'<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TRIAD-3D Export</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  add("vite.config.ts",'import { defineConfig } from "vite"; export default defineConfig({ base: "./" });\n');
  add("package.json",json({ name:"triad-model-export",version:"1.0.0",private:true,type:"module",scripts:{dev:"vite",build:"tsc --noEmit && vite build"},dependencies:{react:"19.3.1","react-dom":"19.3.1",three:"0.186.1"},devDependencies:{typescript:"5.9.3",vite:"8.3.4","@types/react":"19.3.0","@types/react-dom":"19.3.0","@types/three":"0.186.0"} }));
  add("tsconfig.json",json({ compilerOptions:{target:"ES2022",lib:["ES2022","DOM","DOM.Iterable"],module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true,jsx:"react-jsx",resolveJsonModule:true,allowSyntheticDefaultImports:true,noEmit:true},include:["src"] }));
  add("README.md",`# TRIAD-3D export\n\nNode.js 22.12+; npm install; npm run build; npm run dev.\n\nImport src/TriadModel.tsx and retain its sibling runtime modules. Copy public/assets into the host public directory. assetBaseUrl must point to that directory; URLs are relative. Props: width, height, scale (>0), color (#RRGGBB), speed, playing, clipId, controlled time in seconds, onError.\n\nProfile: ${profile}. Profiles change raster resolution/antialiasing; they do not simplify source geometry. WebGL2 via Three WebGPURenderer. No editor, document history or persistence. First clip plays by default. Modifiers are baked at export time; changing animated cutters does not recompute CSG.\n\nDiagnostics:\n${diagnostics.map(d => `- ${d}`).join("\n") || "None."}\n\nThird-party packages React and Three.js use MIT licenses; see installed package LICENSE files. Rights to user-imported resources remain with their respective owners.\n`);
  add("export-report.json",json({profile,triangles,diagnostics,schemaVersion:project.schemaVersion}));
  const bytes = [...files.values()].reduce((sum,b) => sum+b.byteLength,0);
  if (bytes > 256*1024*1024) throw new Error("Экспорт превышает лимит 256 MiB.");
  progress(1); return { files,diagnostics,triangles,bytes,bundle };
}

export async function createExportZip(prepared: PreparedExport, signal?: AbortSignal): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  try {
    for (const [path,bytes] of [...prepared.files].sort(([a],[b]) => a.localeCompare(b))) { signal?.throwIfAborted(); await writer.add(path,new Uint8ArrayReader(bytes),{ lastModDate: new Date("2020-01-01T00:00:00Z"),...(signal ? { signal } : {}) }); }
    return await writer.close();
  } catch (error) { await writer.close().catch(() => {}); throw error; }
}
