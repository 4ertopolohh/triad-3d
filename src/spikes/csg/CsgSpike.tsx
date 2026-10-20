import { useEffect, useRef, useState } from "react";
import { AmbientLight, Color, DirectionalLight, DoubleSide, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CsgClient } from "./client";
import { makeInputs, toThree, type Detail, type MeshData, type Operation } from "./core";

export default function CsgSpike() {
  const mount = useRef<HTMLDivElement>(null);
  const client = useRef<CsgClient | null>(null);
  const [operation, setOperation] = useState<Operation>("subtract");
  const [detail, setDetail] = useState<Detail>("medium");
  const [view, setView] = useState<"input" | "result">("result");
  const [data, setData] = useState<{ inputs: [MeshData, MeshData]; output: MeshData; metrics: string }>();
  const [status, setStatus] = useState("Готово к запуску");

  useEffect(() => { client.current = new CsgClient(); return () => { client.current?.dispose(); client.current = null; }; }, []);
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(host.clientWidth, 480);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new Scene(); scene.background = new Color("#141a24");
    const camera = new PerspectiveCamera(45, host.clientWidth / 480, 0.1, 100);
    camera.position.set(3.5, 3, 5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new AmbientLight("white", 1.8));
    const light = new DirectionalLight("white", 3); light.position.set(3, 4, 6); scene.add(light);
    const meshes: Mesh[] = [];
    const add = (meshData: MeshData, color: string, opacity = 1) => {
      const mesh = new Mesh(toThree(meshData), new MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.35, transparent: opacity < 1, opacity, side: DoubleSide }));
      scene.add(mesh); meshes.push(mesh);
    };
    if (data) {
      if (view === "result") add(data.output, "#65d8e5");
      else { add(data.inputs[0], "#73a7fa", 0.68); add(data.inputs[1], "#f5a75c", 0.68); }
    }
    let frame = 0;
    const animate = () => { frame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    return () => { cancelAnimationFrame(frame); controls.dispose(); for (const mesh of meshes) { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); } renderer.dispose(); renderer.domElement.remove(); };
  }, [data, view]);

  async function run() {
    const inputs = makeInputs(operation, detail);
    setStatus("Вычисление…");
    try {
      const response = await client.current!.run(operation, ...inputs);
      const result = response.result;
      setData({ inputs, output: result.output, metrics: `Вход: ${result.inputTriangles} треугольников · Выход: ${result.outputTriangles} · CSG: ${result.computeMs.toFixed(1)} мс · ${result.status}` });
      setStatus(result.empty ? "Пустое пересечение" : "Готово");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  return <main style={{ padding: 24, color: "#e8eef6", background: "#141a24", minHeight: "100vh", fontFamily: "sans-serif" }}>
    <h1>CSG · TASK-003</h1>
    <p>Эксперимент Manifold WASM. Вращайте камеру мышью.</p>
    <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
      <select aria-label="Операция" value={operation} onChange={(event) => setOperation(event.target.value as Operation)}><option value="subtract">Вычитание</option><option value="union">Объединение</option><option value="intersect">Пересечение</option></select>
      <select aria-label="Детализация" value={detail} onChange={(event) => setDetail(event.target.value as Detail)}><option value="low">Низкая</option><option value="medium">Средняя</option><option value="high">Высокая</option></select>
      <button onClick={run}>Запустить</button><button onClick={() => { client.current?.cancel(); setStatus("JOB_CANCELLED: Вычисление отменено"); }}>Отменить</button>
      <button onClick={() => setView(view === "input" ? "result" : "input")}>Показать {view === "input" ? "результат" : "исходные тела"}</button>
    </div>
    <div ref={mount} style={{ width: "100%", maxWidth: 1000, height: 480 }} />
    <p>{status}</p><p>{data?.metrics}</p>
  </main>;
}
