import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createPhysicalMaterial } from "../renderer/pbr-material";
import { createTriplanarMaterial } from "../renderer/triplanar-material";
import { BaseColorTextures } from "../renderer/base-color-textures";
import { SurfaceTextures } from "../renderer/surface-textures";
import { ProceduralRoughnessTextures } from "../renderer/procedural-roughness-textures";
import { evaluateClip } from "../animation/timeline";
import type { RuntimeBundle } from "./export-types";
import type { Material, Transform } from "../domain/types";

export interface TriadModelProps {
  width?: number | string; height?: number | string; speed?: number; scale?: number;
  color?: string; playing?: boolean; clipId?: string; time?: number; assetBaseUrl?: string;
  nodeOverrides?: Record<string,{scale?: number; color?: string}>;
  onError?: (message: string) => void;
}
export function TriadRuntime({ data, width = "100%", height = 480, speed = 1, scale = 1, color, playing = true, clipId, time, assetBaseUrl = "./", onError, nodeOverrides, assetUrls }: TriadModelProps & { data: RuntimeBundle; assetUrls?: Record<string,string> }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const controls = useRef({ speed, scale, color, playing, clipId, time, onError, nodeOverrides });
  controls.current = { speed, scale, color, playing, clipId, time, onError, nodeOverrides };
  useEffect(() => {
    const host = mount.current; if (!host) return;
    const project = data.project;
    const abort = new AbortController(); let disposed = false, elapsed = 0, last = 0;
    const renderer = new WebGPURenderer({ antialias: data.profile !== "lite", forceWebGL: true });
    const scene = new T.Scene(); const model = new T.Group(); scene.add(model);
    scene.background = new T.Color(...project.scene.background.color).multiplyScalar(project.scene.background.intensity);
    const settings = project.scene.renderSettings;
    renderer.toneMappingExposure = settings?.exposure ?? 1.25;
    renderer.toneMapping = settings?.toneMapping === "none" ? T.NoToneMapping : settings?.toneMapping === "neutral" ? T.NeutralToneMapping : T.ACESFilmicToneMapping;
    const cameraData = project.scene.camera;
    const camera = new T.PerspectiveCamera(cameraData.fovDegrees, 1, cameraData.near, cameraData.far);
    camera.position.fromArray(cameraData.position); camera.lookAt(...cameraData.target);
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
    const colors = new Map<T.Color,T.Color>();
    const objects = new Map<string,T.Object3D>();
    const bytes = new Map<string,Uint8Array>();
    const fail = (message: string) => { if (!disposed) { setError(message); controls.current.onError?.(message); } };
    const base = new BaseColorTextures(() => { const errors = base.diagnostics(); if (errors.length) fail(errors.join("; ")); });
    const surface = new SurfaceTextures(() => { const errors = surface.diagnostics(); if (errors.length) fail(errors.join("; ")); });
    const roughness = new ProceduralRoughnessTextures();
    const apply = (object: T.Object3D, transform: Transform) => { object.position.fromArray(transform.position); object.quaternion.fromArray(transform.rotationQuat).normalize(); object.scale.fromArray(transform.scale); };
    const material = (value?: Material, hasUv = true) => {
      const result = value?.textureMappings?.baseColor?.mode === "triplanar" ? createTriplanarMaterial(value) : createPhysicalMaterial(value);
      materials.add(result);
      colors.set(result.color,result.color.clone());
      if (!value) return result;
      if (hasUv) {
        surface.bind(result,value,project.assets,id => bytes.get(id));
        if (value.proceduralMaps?.roughness && !value.textureSlots?.roughness) roughness.bind(result,value.proceduralMaps.roughness,value.roughness);
      }
      const asset = project.assets.find(a => a.id === value.textureSlots?.baseColor);
      const projection = value.textureMappings?.baseColor;
      if (asset && (hasUv || projection?.mode === "triplanar")) base.bind(result,asset,id => bytes.get(id),projection !== undefined && projection.mode !== "uv",projection?.mode === "triplanar" ? projection : undefined);
      return result;
    };
    for (const light of project.scene.lights) {
      const lightColor = new T.Color(...light.color);
      const object = light.kind === "ambient" ? new T.AmbientLight(lightColor,light.intensity) : light.kind === "directional" ? new T.DirectionalLight(lightColor,light.intensity) : light.kind === "spot" ? new T.SpotLight(lightColor,light.intensity) : new T.PointLight(lightColor,light.intensity);
      object.position.fromArray(light.position);
      if (object instanceof T.DirectionalLight || object instanceof T.SpotLight) { object.target.position.fromArray(light.target); scene.add(object.target); }
      scene.add(object);
    }
    const resize = () => { if (disposed) return; const rect = host.getBoundingClientRect(); const w = Math.max(1,rect.width), h = Math.max(1,rect.height); renderer.setPixelRatio(Math.min(devicePixelRatio,data.profile === "max" ? 2 : data.profile === "balanced" ? 1.5 : 1)); renderer.setSize(w,h); camera.aspect = w/h; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(host);
    void (async () => {
      setError("");
      for (const asset of project.assets) {
        const response = await fetch(assetUrls?.[asset.id] ?? new URL(asset.path,new URL(assetBaseUrl,document.baseURI)), { signal: abort.signal });
        if (!response.ok) throw new Error(`Ресурс ${asset.path}: HTTP ${response.status}`);
        bytes.set(asset.id,new Uint8Array(await response.arrayBuffer()));
      }
      if (disposed) return;
      for (const node of project.nodes) {
        const group = new T.Group(); group.name = node.name; group.visible = node.visible; apply(group,node.transform); objects.set(node.id,group);
        if (node.kind !== "mesh") continue;
        const geometry = data.geometries[node.id];
        if (geometry) {
          const buffer = new T.BufferGeometry(); geometries.add(buffer);
          buffer.setAttribute("position",new T.Float32BufferAttribute(geometry.positions,3));
          if (geometry.indices) buffer.setIndex(geometry.indices);
          if (geometry.normals) buffer.setAttribute("normal",new T.Float32BufferAttribute(geometry.normals,3)); else buffer.computeVertexNormals();
          if (geometry.uv) buffer.setAttribute("uv",new T.Float32BufferAttribute(geometry.uv,2));
          if (geometry.colors) buffer.setAttribute("color",new T.Float32BufferAttribute(geometry.colors,3));
          geometry.groups.forEach(g => buffer.addGroup(g.start,g.count,g.materialIndex));
          const list = node.materialSlots.map((slot,i) => material(project.materials.find(m => m.id === slot.materialId),!!geometry.uv && !geometry.missingUvSlots?.includes(i)));
          if (!list.length) list.push(material());
          list.forEach(m => { m.vertexColors = !!geometry.colors; });
          group.add(new T.Mesh(buffer,list.length > 1 && buffer.groups.length ? list : list[0]));
        } else if (node.meshSource.kind === "asset") {
          const source = bytes.get(node.meshSource.assetId); if (!source) throw new Error("GLB отсутствует.");
          const manager = new T.LoadingManager();
          manager.setURLModifier(url => { if (!url.startsWith("blob:")) throw new Error("Внешние URI в GLB запрещены."); return url; });
          const gltf = await new GLTFLoader(manager).parseAsync(source.slice().buffer,"");
          gltf.scene.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); if ("color" in m && m.color instanceof T.Color) colors.set(m.color,m.color.clone()); for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value); } if (node.materialSlots.length) o.material = material(project.materials.find(m => m.id === node.materialSlots[0]!.materialId),!!o.geometry.getAttribute("uv")); } });
          if (disposed) { cleanupResources(); return; }
          group.add(gltf.scene);
        }
      }
      for (const node of project.nodes) (node.parentId ? objects.get(node.parentId)! : model).add(objects.get(node.id)!);
      const environmentId = project.scene.background.environmentAssetId;
      if (environmentId) {
        const asset = project.assets.find(a => a.id === environmentId)!;
        const source = bytes.get(environmentId)!;
        const parsed = asset.mediaType === "image/x-exr" ? new EXRLoader().setDataType(T.FloatType).parse(source.slice().buffer) : new HDRLoader().setDataType(T.FloatType).parse(source.slice().buffer);
        const texture = new T.DataTexture(parsed.data,parsed.width,parsed.height,T.RGBAFormat,parsed.type);
        texture.flipY = "flipY" in parsed ? parsed.flipY ?? false : false; texture.colorSpace = T.LinearSRGBColorSpace; texture.mapping = T.EquirectangularReflectionMapping; texture.needsUpdate = true; textures.add(texture);
        scene.environment = texture; scene.environmentIntensity = project.scene.background.environmentIntensity ?? 1; scene.environmentRotation.y = project.scene.background.environmentRotation ?? 0;
      }
      await renderer.init(); if (disposed) { void renderer.dispose(); return; }
      host.appendChild(renderer.domElement); resize();
      renderer.setAnimationLoop((now: number) => {
        if (disposed) return;
        const control = controls.current;
        if (last && control.playing && Number.isFinite(control.speed) && control.speed >= 0 && control.speed <= 100) elapsed += (now-last)/1000*control.speed;
        last = now;
        const clip = project.animations.find(c => c.id === control.clipId) ?? project.animations[0];
        const seconds = control.time !== undefined && Number.isFinite(control.time) ? control.time : elapsed;
        const pose = clip ? evaluateClip(project,clip.id,seconds,control.time === undefined) : new Map<string,Transform>();
        for (const node of project.nodes) apply(objects.get(node.id)!,pose.get(node.id) ?? node.transform);
        model.scale.setScalar(Number.isFinite(control.scale) && control.scale > 0 ? control.scale : 1);
        for (const [target,original] of colors) { if (control.color && /^#[0-9a-f]{6}$/i.test(control.color)) target.set(control.color); else target.copy(original); }
        for (const [id,override] of Object.entries(control.nodeOverrides ?? {})) {
          const object = objects.get(id); if (!object) continue;
          if (Number.isFinite(override.scale) && override.scale! > 0) object.scale.multiplyScalar(override.scale!);
          if (override.color && /^#[0-9a-f]{6}$/i.test(override.color)) object.traverse(child => {
            if (child instanceof T.Mesh) for (const m of Array.isArray(child.material) ? child.material : [child.material])
              if ("color" in m && m.color instanceof T.Color) m.color.set(override.color!);
          });
        }
        renderer.render(scene,camera);
      });
    })().catch(error => { if (!disposed) fail(error instanceof Error ? error.message : String(error)); });
    function cleanupResources() { base.dispose(); surface.dispose(); roughness.dispose(); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); textures.clear(); materials.clear(); geometries.clear(); }
    return () => { disposed = true; abort.abort(); observer.disconnect(); renderer.setAnimationLoop(null); cleanupResources(); renderer.domElement.remove(); void renderer.dispose(); };
  }, [data,assetBaseUrl,assetUrls]);
  return <div style={{ width,height,position:"relative" }}><div ref={mount} style={{width:"100%",height:"100%"}} />{error && <p role="alert" style={{position:"absolute",top:0}}>{error}</p>}</div>;
}
