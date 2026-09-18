import { Color3, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";

import type { ClientFeature, SnapshotMessage } from "../feature-api";

interface DeathBallState {
  readonly x: number;
  readonly z: number;
  readonly rotation: number;
}

export default function createDeathBall(scene: Scene): ClientFeature {
  const material = new StandardMaterial("death-ball", scene);
  material.diffuseColor = new Color3(0.9, 0.08, 0.035);
  material.emissiveColor = material.diffuseColor.scale(0.8);
  material.specularColor = Color3.Black();
  const ball = MeshBuilder.CreateSphere("death-ball", { diameter: 1.5, segments: 16 }, scene);
  ball.material = material;
  ball.setEnabled(false);

  return {
    update(snapshot: SnapshotMessage): void {
      const state = snapshot.features.deathBall;
      if (!isDeathBallState(state)) {
        ball.setEnabled(false);
        return;
      }
      ball.position.set(state.x, 0.75, state.z);
      ball.rotation.x = state.rotation;
      ball.setEnabled(true);
    },
  };
}

function isDeathBallState(value: unknown): value is DeathBallState {
  if (value === null || typeof value !== "object") return false;
  const state = value as Partial<DeathBallState>;
  return typeof state.x === "number" && typeof state.z === "number" && typeof state.rotation === "number";
}