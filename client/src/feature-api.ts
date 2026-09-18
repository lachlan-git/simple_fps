import type { Scene } from "@babylonjs/core";

export interface PlayerState {
  readonly id: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly health: number;
  readonly respawnAtMs: number | null;
  readonly features: Readonly<Record<string, unknown>>;
}

export interface SnapshotMessage {
  readonly type: "snapshot";
  readonly phase: string;
  readonly players: readonly PlayerState[];
  readonly features: Readonly<Record<string, unknown>>;
}

export interface ClientFeature {
  update(snapshot: SnapshotMessage, localPlayer: PlayerState | null): void;
  playerStatus?(player: PlayerState): string | null;
  canShoot?(player: PlayerState | null): boolean;
  onLocalShot?(): void;
  render?(deltaSeconds: number, nowMs: number): void;
}

type ClientFeatureFactory = (scene: Scene) => ClientFeature;

export function createClientFeatures(scene: Scene): ClientFeature[] {
  const factories = import.meta.glob("./features/*.ts", {
    eager: true,
    import: "default",
  }) as Record<string, ClientFeatureFactory>;
  return Object.entries(factories)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, createFeature]) => createFeature(scene));
}