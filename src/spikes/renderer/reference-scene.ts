import * as THREE from "three/webgpu";

export const CAMERA_POSITION = new THREE.Vector3(0, 2.7, 9.2);
export const CAMERA_TARGET = new THREE.Vector3(0, 0.65, 0);

function normalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = x / 256 * Math.PI * 16;
    const v = y / 256 * Math.PI * 16;
    const dx = Math.cos(u) * Math.sin(v) * 0.65;
    const dy = Math.sin(u) * Math.cos(v) * 0.65;
    const length = Math.hypot(dx, dy, 1);
    const offset = (y * 256 + x) * 4;
    image.data[offset] = Math.round((dx / length * 0.5 + 0.5) * 255);
    image.data[offset + 1] = Math.round((dy / length * 0.5 + 0.5) * 255);
    image.data[offset + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

export function createReferenceScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x252b34);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.copy(CAMERA_POSITION);
  camera.lookAt(CAMERA_TARGET);
  const ownedGeometry: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const normalMap = normalTexture();

  function add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
    ownedGeometry.push(geometry);
    ownedMaterials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  }

  add(new THREE.SphereGeometry(0.95, 64, 48), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.08,
  }), -2.25, 0.85, 0);

  add(new THREE.SphereGeometry(0.95, 64, 48), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.04,
    transmission: 1, ior: 1.5, thickness: 1.4, opacity: 1,
  }), 0, 0.85, 0);

  const normalMesh = add(new THREE.SphereGeometry(0.95, 64, 48), new THREE.MeshPhysicalMaterial({
    color: 0x8eabd3, metalness: 0.12, roughness: 0.42,
    normalMap, normalScale: new THREE.Vector2(0.75, 0.75),
  }), 2.25, 0.85, 0);
  normalMesh.rotation.y = 0.35;

  add(new THREE.BoxGeometry(7.5, 0.12, 3), new THREE.MeshStandardMaterial({
    color: 0x343b46, metalness: 0.05, roughness: 0.72,
  }), 0, -0.18, 0);
  // The striped target behind glass makes transmission visible independently of its opacity.
  for (let i = 0; i < 7; i++) {
    add(new THREE.BoxGeometry(0.08, 1.6, 0.025), new THREE.MeshBasicMaterial({
      color: i % 2 ? 0xd8a66a : 0xe1e9f4,
    }), (i - 3) * 0.2, 0.8, -1.15);
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(-2, 5, 4);
  scene.add(ambient, key);

  return {
    scene, camera,
    dispose() {
      normalMap.dispose();
      for (const geometry of ownedGeometry) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
    },
  };
}
