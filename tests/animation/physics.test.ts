import { beforeAll, describe, expect, it } from "vitest";
import { initializePhysics, PhysicsWorld, type PhysicsInput } from "../../src/animation/physics";
import { physicsError } from "../../src/domain/physics-config";

beforeAll(initializePhysics);
const input = (id: string, body: "static" | "dynamic" | "kinematic", y: number): PhysicsInput => ({
  id, actor: { nodeId: id, enabled: true, body, collider: "box", size: [1, 1, 1], mass: 1, restitution: .9, friction: .5 },
  pose: { position: [0, y, 0], rotationQuat: [0, 0, 0, 1] }, scale: [1, 1, 1],
});

describe("Rapier collision adapter", () => {
  it("bounces on a static floor and maps contact begin/end to stable IDs", () => {
    const floor = input("floor", "static", -.5); floor.actor.size = [20, 1, 20];
    const ball = input("ball", "dynamic", 3); ball.actor.collider = "sphere";
    const world = new PhysicsWorld([floor, ball]);
    try {
      const events = []; let minimum = Infinity, rebound = 0;
      for (let i = 0; i < 120; i++) {
        events.push(...world.advance(1 / 60));
        const y = world.pose("ball")!.position[1]; minimum = Math.min(minimum, y);
        if (minimum < .6) rebound = Math.max(rebound, y);
      }
      expect(minimum).toBeGreaterThan(.4); expect(minimum).toBeLessThan(.6); expect(rebound).toBeGreaterThan(1.5);
      expect(events.some(e => e.started && new Set([e.first, e.second]).has("ball"))).toBe(true);
      expect(events.some(e => !e.started)).toBe(true);
      expect(world.pose("floor")!.position[1]).toBe(-.5);
      expect(ball.pose.position[1]).toBe(3);
    } finally { world.dispose(); world.dispose(); }
  });
  it("uses fixed steps independent of render frequency and bounded catch-up", () => {
    const a = new PhysicsWorld([input("box", "dynamic", 10)]), b = new PhysicsWorld([input("box", "dynamic", 10)]);
    try {
      for (let i = 0; i < 60; i++) a.advance(1 / 60);
      for (let i = 0; i < 120; i++) b.advance(1 / 120);
      expect(a.pose("box")).toEqual(b.pose("box"));
      const before = a.pose("box")!.position[1]; a.advance(100);
      expect(before - a.pose("box")!.position[1]).toBeLessThan(2);
      expect(() => a.advance(NaN)).toThrow();
    } finally { a.dispose(); b.dispose(); }
  });
  it("follows kinematic targets, omits disabled actors, rejects unsafe configuration", () => {
    const actor = input("platform", "kinematic", 0), disabled = input("disabled", "dynamic", 5); disabled.actor.enabled = false;
    const world = new PhysicsWorld([actor, disabled]);
    try {
      world.advance(1 / 60, new Map([["platform", { position: [0, 2, 0], rotationQuat: [0, 0, 0, 1] }]]));
      expect(world.pose("platform")!.position[1]).toBeCloseTo(2);
      expect(world.pose("disabled")).toBeUndefined();
      expect(physicsError([{ ...actor.actor, script: "evil()" }], new Set(["platform"]))).not.toBeNull();
      expect(physicsError([actor.actor, actor.actor], new Set(["platform"]))).not.toBeNull();
    } finally { world.dispose(); }
    expect(() => world.advance(1 / 60)).toThrow();
  });
});
