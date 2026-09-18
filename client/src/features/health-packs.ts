import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";

import type { ClientFeature, SnapshotMessage } from "../feature-api";

interface HealthPackState {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export default function createHealthPacks(scene: Scene): ClientFeature {
  const material = new StandardMaterial("health-pack", scene);
  material.diffuseColor = new Color3(0.12, 0.82, 0.32);
  material.emissiveColor = material.diffuseColor.scale(0.8);
  material.specularColor = Color3.Black();
  const packs = new Map<string, Mesh>();

  return {
    update(snapshot: SnapshotMessage): void {
      const value = snapshot.features.healthPacks;
      const states = Array.isArray(value) ? value.filter(isHealthPackState) : [];
      const seen = new Set<string>();
      for (const state of states) {
        seen.add(state.id);
        let pack = packs.get(state.id);
        if (pack === undefined) {
          pack = MeshBuilder.CreateBox(`health-pack-${state.id}`, {
            width: 0.8,
            height: 0.35,
            depth: 0.55,
          }, scene);
          pack.material = material;
          packs.set(state.id, pack);
        }
        pack.position.set(state.x, 0.4, state.z);
      }
      for (const [id, pack] of packs) {
        if (seen.has(id)) continue;
        pack.dispose();
        packs.delete(id);
      }
    },
    render(deltaSeconds: number, nowMs: number): void {
      for (const pack of packs.values()) {
        pack.rotation.y += deltaSeconds * 1.8;
        pack.position.y = 0.4 + Math.sin(nowMs / 280) * 0.08;
      }
    },
  };
}

function isHealthPackState(value: unknown): value is HealthPackState {
  if (value === null || typeof value !== "object") return false;
  const state = value as Partial<HealthPackState>;
  return typeof state.id === "string" && typeof state.x === "number" && typeof state.z === "number";
}