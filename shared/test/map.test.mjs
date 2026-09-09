import assert from "node:assert/strict";
import test from "node:test";

import { collidesWithArena, raycastArena, raycastPlayer } from "../dist/index.js";

test("player collision matches rendered obstacle bounds", () => {
  assert.equal(collidesWithArena(-17, -16), true);
  assert.equal(collidesWithArena(0, 0), false);
});

test("raycasting blocks walls while allowing shots above low cover", () => {
  assert.equal(raycastArena({ x: -5, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, 30), 9.5);
  assert.equal(raycastArena({ x: -3.5, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 30), 1.9);
  assert.equal(raycastArena({ x: -3.5, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, 30), 9.5);
});

test("player hitboxes keep aim tolerance fixed at range", () => {
  const origin = { x: 0, y: 1.7, z: 0 };
  const forward = { x: 0, y: 0, z: 1 };

  assert.equal(raycastPlayer(origin, forward, { x: 2, y: 1.7, z: 20 }, 30), null);
  assert.ok(raycastPlayer(origin, forward, { x: 0, y: 1.7, z: 20 }, 30) !== null);
});