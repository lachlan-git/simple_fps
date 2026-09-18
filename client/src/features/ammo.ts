import type { Scene } from "@babylonjs/core";

import type { ClientFeature, PlayerState, SnapshotMessage } from "../feature-api";

const SPAWN_AMMO = 6;

export default function createAmmo(_scene: Scene): ClientFeature {
  let ammo = SPAWN_AMMO;

  return {
    update(_snapshot: SnapshotMessage, localPlayer: PlayerState | null): void {
      const value = localPlayer?.features.ammo;
      if (typeof value === "number") ammo = value;
    },
    playerStatus(): string {
      return `${ammo} / ${SPAWN_AMMO}`;
    },
    canShoot(): boolean {
      return ammo > 0;
    },
    onLocalShot(): void {
      ammo = Math.max(0, ammo - 1);
    },
  };
}