import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { CAMERA_POSITION, CAMERA_TARGET, createReferenceScene } from "./reference-scene";
import hdriUrl from "./assets/studio_small_03_1k.hdr?url";
import "./renderer-spike.css";

type Mode = "auto" | "webgl2";
type Backend = "WebGPU" | "WebGL2" | "не определён";

function actualBackend(renderer: THREE.WebGPURenderer): Backend {
  // Renderer.backend changes to the fallback instance during await renderer.init().
  if ("isWebGPUBackend" in renderer.backend && renderer.backend.isWebGPUBackend === true) return "WebGPU";
  if ("isWebGLBackend" in renderer.backend && renderer.backend.isWebGLBackend === true) return "WebGL2";
  return "не определён";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function RendererSpike() {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => {});
  const [mode, setMode] = useState<Mode>("auto");
  const [attempt, setAttempt] = useState(0);
  const [backend, setBackend] = useState<Backend>("не определён");
  const [initialization, setInitialization] = useState("Инициализация…");
  const [hdri, setHdri] = useState("Ожидание загрузки…");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const mount = element;
    let cancelled = false;
    let renderer: THREE.WebGPURenderer | undefined;
    let controls: OrbitControls | undefined;
    let environment: THREE.DataTexture | undefined;
    const reference = createReferenceScene();
    const resize = () => {
      if (!renderer || cancelled) return;
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      reference.camera.aspect = width / height;
      reference.camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    setBackend("не определён");
    setInitialization("Инициализация…");
    setHdri("Ожидание загрузки…");
    setError("");

    async function initialize() {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: mode === "webgl2" });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.25;
        await renderer.init();
        if (cancelled) return;
        const actual = actualBackend(renderer);
        if (actual === "не определён") throw new Error("Three.js не сообщил выбранный backend.");
        setBackend(actual);
        controls = new OrbitControls(reference.camera, renderer.domElement);
        controls.target.copy(CAMERA_TARGET);
        controls.enableDamping = false;
        controls.update();
        resetView.current = () => {
          reference.camera.position.copy(CAMERA_POSITION);
          controls?.target.copy(CAMERA_TARGET);
          controls?.update();
        };
        mount.appendChild(renderer.domElement);
        resize();
        setInitialization("Готово");
        const activeRenderer = renderer;
        // One animation loop per renderer; cleanup stops it before disposal.
        await activeRenderer.setAnimationLoop(() => {
          if (cancelled) return;
          try { activeRenderer.render(reference.scene, reference.camera); }
          catch (cause) {
            setError(`Ошибка кадра: ${errorText(cause)}`);
            setInitialization("Ошибка");
            void activeRenderer.setAnimationLoop(null);
          }
        });
        setHdri("Загрузка…");
        try {
          const texture = await new HDRLoader().loadAsync(hdriUrl);
          if (cancelled) { texture.dispose(); return; }
          environment = texture;
          texture.mapping = THREE.EquirectangularReflectionMapping;
          reference.scene.environment = texture;
          reference.scene.background = texture;
          setHdri("Загружен — Poly Haven studio_small_03, 1K HDR");
        } catch (cause) {
          if (!cancelled) {
            setHdri("FAILED — нейтральное освещение");
            setError(`HDRI: ${errorText(cause)}`);
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setInitialization("Ошибка");
          setError(`Не удалось запустить рендерер: ${errorText(cause)}`);
        }
      }
    }
    const initializationJob = initialize();
    return () => {
      cancelled = true;
      resetView.current = () => {};
      observer.disconnect();
      controls?.dispose();
      if (renderer) {
        void renderer.setAnimationLoop(null);
        renderer.domElement.remove();
      }
      void initializationJob.finally(async () => {
        if (renderer) await renderer.dispose();
        environment?.dispose();
        reference.dispose();
      });
    };
  }, [mode, attempt]);

  return <main className="renderer-spike">
    <header className="renderer-spike__header">
      <div><p className="renderer-spike__eyebrow">TRIAD-3D · TASK-002</p><h1>Проверка PBR-рендеринга</h1></div>
      <a href="/">Вернуться в редактор</a>
    </header>
    <div className="renderer-spike__toolbar">
      <label>Режим <select aria-label="Режим рендеринга" value={mode} onChange={event => setMode(event.target.value as Mode)}>
        <option value="auto">Auto / приоритет WebGPU</option>
        <option value="webgl2">Принудительно WebGL2</option>
      </select></label>
      <button onClick={() => resetView.current()}>Сбросить вид</button>
      <button onClick={() => setAttempt(value => value + 1)}>Повторить запуск</button>
    </div>
    <div className="renderer-spike__viewport" ref={host} aria-label="Эталонная 3D-сцена" />
    <section className="renderer-spike__diagnostics" aria-live="polite">
      <span>Запрошено: {mode === "auto" ? "Auto / WebGPU preferred" : "Forced WebGL2"}</span>
      <span>Фактически: <strong>{backend}</strong></span>
      <span>Инициализация: {initialization}</span>
      <span>HDRI: {hdri}</span>
      {error && <p role="alert">{error}</p>}
    </section>
    <p className="renderer-spike__legend">Слева — хром · В центре — оптическое стекло · Справа — normal map. Перетащите для вращения камеры; колесо меняет масштаб.</p>
  </main>;
}
