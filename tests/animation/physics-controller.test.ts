import { expect, it } from "vitest";
import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { PhysicsController } from "../../src/animation/physics-controller";
import { initializePhysics } from "../../src/animation/physics";
import type { PhysicsActor } from "../../src/domain/physics-config";

it("keeps falling across restored render poses and rejects nonuniform parents", async () => {
  await initializePhysics();
  const root = new Group(), object = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); root.add(object);
  const messages: string[] = [], controller = new PhysicsController(message => messages.push(message));
  const actor: PhysicsActor = { nodeId: "box", enabled: true, body: "dynamic", collider: "box", size: [1, 1, 1], mass: 1, restitution: .5, friction: .5 };
  const scopes = [{ id: "copy", actors: [actor], objects: new Map([["box", object]]) }];
  try {
    controller.apply(scopes, 0); await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 60; i++) { object.position.set(0, 10, 0); object.quaternion.identity(); controller.apply(scopes, 1 / 60); }
    expect(object.position.y).toBeLessThan(6); expect(object.position.y).toBeGreaterThan(4);
    controller.reset(); object.position.set(0, 10, 0); controller.apply(scopes, 0); expect(object.position.y).toBe(10);
    root.scale.set(2, 1, 1); controller.apply(scopes, 1 / 60); expect(messages.join()).toContain("равномерный масштаб");
  } finally { controller.dispose(); object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); }
});
