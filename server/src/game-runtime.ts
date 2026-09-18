import type { WebSocket } from "ws";
import { z } from "zod";

import { PLAYER_EYE_HEIGHT, collidesWithArena, raycastArena, raycastPlayer } from "@battleprompt/game-shared";

type PlayerId = string;

export interface RoomConfig {
  readonly maxPlayers: number;
  readonly warmupSeconds: number;
  readonly roundSeconds: number;
  readonly finalVoteSeconds: number;
  readonly activationSeconds: number;
  readonly candidateWaitSeconds: number;
  readonly respawnSeconds: number;
  readonly startingHealth: number;
  readonly weaponDamage: number;
  readonly maxPointsPerCall: number;
}

const SIMULATION_HZ = 60;
const PLAYER_SPEED = 6;
const JUMP_SPEED = 7.5;
const GRAVITY = 20;

const InputMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticate"), token: z.string().min(32).max(2048) }).strict(),
  z.object({
    type: z.literal("input"),
    forward: z.number().min(-1).max(1),
    strafe: z.number().min(-1).max(1),
    jump: z.boolean(),
    yaw: z.number().finite(),
    pitch: z.number().finite().min(-1.5).max(1.5),
  }).strict(),
  z.object({
    type: z.literal("shoot"),
    yaw: z.number().finite(),
    pitch: z.number().finite().min(-1.5).max(1.5),
  }).strict(),
]);

interface RuntimePlayer {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly socket: WebSocket;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  respawnAtMs: number | null;
  forward: number;
  strafe: number;
  jumpQueued: boolean;
  verticalVelocity: number;
  lastShotAtMs: number;
  messageWindowStartedAtMs: number;
  messagesInWindow: number;
}

interface GameRoom {
  readonly code: string;
  readonly players: Map<PlayerId, RuntimePlayer>;
  config: RoomConfig;
  tick: number;
}

export interface ControlPlanePlayer {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly points: number;
}

export interface ControlPlaneRoom {
  readonly state: {
    readonly config: RoomConfig;
    readonly phase: string;
    readonly deadlineMs: number | null;
  };
  readonly players: readonly ControlPlanePlayer[];
}

export interface GameControlPlane {
  authenticatePlayer(code: string, token: string): ControlPlanePlayer | Promise<ControlPlanePlayer>;
  getRoom(code: string, nowMs?: number): ControlPlaneRoom;
  addPoints(code: string, playerId: string, points: number, nowMs?: number): unknown;
  close?(): void;
}

export class GameRuntime {
  readonly #rooms = new Map<string, GameRoom>();
  readonly #interval: NodeJS.Timeout;

  public constructor(private readonly controlPlane: GameControlPlane) {
    this.#interval = setInterval(() => this.#simulate(Date.now()), 1000 / SIMULATION_HZ);
    this.#interval.unref();
  }

  public accept(socket: WebSocket, codeInput: string): void {
    const code = codeInput.trim().toUpperCase();
    let player: RuntimePlayer | undefined;
    let authenticationInProgress = false;
    const authenticationTimeout = setTimeout(() => socket.close(4401, "Authentication required"), 5_000);
    authenticationTimeout.unref();

    socket.on("message", (rawData) => {
      const messageBuffer = Array.isArray(rawData)
        ? Buffer.concat(rawData)
        : Buffer.isBuffer(rawData)
          ? rawData
          : Buffer.from(rawData);
      if (messageBuffer.byteLength > 4_096) {
        socket.close(4400, "Message too large");
        return;
      }

      let input: z.infer<typeof InputMessageSchema>;
      try {
        input = InputMessageSchema.parse(JSON.parse(messageBuffer.toString("utf8")));
      } catch {
        socket.close(4400, "Invalid message");
        return;
      }

      if (player === undefined) {
        if (input.type !== "authenticate" || authenticationInProgress) {
          socket.close(4401, "Authentication required");
          return;
        }
        authenticationInProgress = true;
        void Promise.resolve(this.controlPlane.authenticatePlayer(code, input.token))
          .then((identity) => {
            const roomSnapshot = this.controlPlane.getRoom(code);
            const room = this.#rooms.get(code) ?? {
              code,
              players: new Map(),
              config: roomSnapshot.state.config,
              tick: 0,
            };
            room.config = roomSnapshot.state.config;
            this.#rooms.set(code, room);
            room.players.get(identity.id)?.socket.close(4409, "Connected elsewhere");
            player = createRuntimePlayer(identity, socket, room.config, room.players.size);
            room.players.set(identity.id, player);
            clearTimeout(authenticationTimeout);
            send(socket, { type: "authenticated", playerId: identity.id, config: room.config });
          })
          .catch(() => socket.close(4401, "Invalid player credentials"))
          .finally(() => { authenticationInProgress = false; });
        return;
      }

      if (!allowMessage(player, Date.now())) {
        socket.close(4429, "Rate limit exceeded");
        return;
      }
      if (input.type === "input") {
        player.forward = input.forward;
        player.strafe = input.strafe;
        if (input.jump) player.jumpQueued = true;
        player.yaw = normalizeAngle(input.yaw);
        player.pitch = input.pitch;
      } else if (input.type === "shoot") {
        this.#shoot(code, player, input.yaw, input.pitch, Date.now());
      }
    });

    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (player !== undefined) {
        this.#rooms.get(code)?.players.delete(player.id);
      }
    });
  }

  public close(): void {
    clearInterval(this.#interval);
    this.controlPlane.close?.();
    for (const room of this.#rooms.values()) {
      for (const player of room.players.values()) {
        player.socket.close(1001, "Server shutting down");
      }
    }
  }

  #simulate(nowMs: number): void {
    for (const room of this.#rooms.values()) {
      room.tick += 1;
      for (const player of room.players.values()) {
        if (player.respawnAtMs !== null) {
          if (nowMs >= player.respawnAtMs) {
            const spawn = spawnPoint(room.players.size + room.tick);
            player.x = spawn.x;
            player.y = PLAYER_EYE_HEIGHT;
            player.z = spawn.z;
            player.yaw = Math.atan2(-spawn.x, -spawn.z);
            player.pitch = 0;
            player.health = room.config.startingHealth;
            player.respawnAtMs = null;
            player.jumpQueued = false;
            player.verticalVelocity = 0;
          }
          continue;
        }
        const speedPerTick = PLAYER_SPEED / SIMULATION_HZ;
        const inputLength = Math.hypot(player.forward, player.strafe) || 1;
        const forwardInput = player.forward / Math.max(1, inputLength);
        const strafeInput = player.strafe / Math.max(1, inputLength);
        const forwardX = Math.sin(player.yaw);
        const forwardZ = Math.cos(player.yaw);
        const rightX = Math.cos(player.yaw);
        const rightZ = -Math.sin(player.yaw);
        const nextX = clamp(player.x + (forwardX * forwardInput + rightX * strafeInput) * speedPerTick, -23, 23);
        const nextZ = clamp(player.z + (forwardZ * forwardInput + rightZ * strafeInput) * speedPerTick, -23, 23);
        if (!collidesWithArena(nextX, player.z)) {
          player.x = nextX;
        }
        if (!collidesWithArena(player.x, nextZ)) {
          player.z = nextZ;
        }
        if (player.jumpQueued && player.y <= PLAYER_EYE_HEIGHT) {
          player.verticalVelocity = JUMP_SPEED;
        }
        player.jumpQueued = false;
        player.verticalVelocity -= GRAVITY / SIMULATION_HZ;
        player.y += player.verticalVelocity / SIMULATION_HZ;
        if (player.y <= PLAYER_EYE_HEIGHT) {
          player.y = PLAYER_EYE_HEIGHT;
          player.verticalVelocity = 0;
        }
      }

      const roomSnapshot = this.controlPlane.getRoom(room.code, nowMs);
      const snapshot = JSON.stringify({
        type: "snapshot",
        tick: room.tick,
        phase: roomSnapshot.state.phase,
        deadlineMs: roomSnapshot.state.deadlineMs,
        scores: roomSnapshot.players,
        players: [...room.players.values()].map((player) => ({
          id: player.id,
          displayName: player.displayName,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          pitch: player.pitch,
          health: player.health,
          respawnAtMs: player.respawnAtMs,
        })),
      });
      for (const player of room.players.values()) {
        if (player.socket.readyState === player.socket.OPEN) {
          player.socket.send(snapshot);
        }
      }
    }
  }

  #shoot(code: string, attacker: RuntimePlayer, yaw: number, pitch: number, nowMs: number): void {
    if (attacker.respawnAtMs !== null || nowMs - attacker.lastShotAtMs < 250) {
      return;
    }
    attacker.lastShotAtMs = nowMs;
    const room = this.#rooms.get(code);
    if (room === undefined) {
      return;
    }

    const direction = {
      x: Math.sin(yaw) * Math.cos(pitch),
      y: -Math.sin(pitch),
      z: Math.cos(yaw) * Math.cos(pitch),
    };
    const origin = { x: attacker.x, y: attacker.y, z: attacker.z };
    const obstacleDistance = raycastArena(origin, direction, 30) ?? 30;
    let target: RuntimePlayer | undefined;
    let targetDistance = Number.POSITIVE_INFINITY;
    for (const candidate of room.players.values()) {
      if (candidate.id === attacker.id || candidate.respawnAtMs !== null) {
        continue;
      }
      const distance = raycastPlayer(origin, direction, candidate, obstacleDistance);
      if (distance !== null && distance < targetDistance) {
        target = candidate;
        targetDistance = distance;
      }
    }

    const end = target === undefined
      ? {
          x: origin.x + direction.x * obstacleDistance,
          y: origin.y + direction.y * obstacleDistance,
          z: origin.z + direction.z * obstacleDistance,
        }
      : { x: target.x, y: target.y, z: target.z };

    let eliminated = false;
    if (target !== undefined) {
      target.health = Math.max(0, target.health - room.config.weaponDamage);
      eliminated = target.health === 0;
    }
    this.#broadcast(room, {
      type: "shot",
      attackerId: attacker.id,
      victimId: target?.id ?? null,
      origin,
      end,
      damage: target === undefined ? 0 : room.config.weaponDamage,
      eliminated,
    });

    if (target !== undefined && eliminated) {
      target.respawnAtMs = nowMs + room.config.respawnSeconds * 1_000;
      void Promise.resolve(this.controlPlane.addPoints(code, attacker.id, 1, nowMs)).catch(() => undefined);
    }
  }

  #broadcast(room: GameRoom, message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const player of room.players.values()) {
      if (player.socket.readyState === player.socket.OPEN) {
        player.socket.send(serialized);
      }
    }
  }
}

function createRuntimePlayer(
  identity: ControlPlanePlayer,
  socket: WebSocket,
  config: RoomConfig,
  spawnIndex: number,
): RuntimePlayer {
  const spawn = spawnPoint(spawnIndex);
  return {
    id: identity.id,
    displayName: identity.displayName,
    socket,
    x: spawn.x,
    y: PLAYER_EYE_HEIGHT,
    z: spawn.z,
    yaw: Math.atan2(-spawn.x, -spawn.z),
    pitch: 0,
    health: config.startingHealth,
    respawnAtMs: null,
    forward: 0,
    strafe: 0,
    jumpQueued: false,
    verticalVelocity: 0,
    lastShotAtMs: 0,
    messageWindowStartedAtMs: Date.now(),
    messagesInWindow: 0,
  };
}

function allowMessage(player: RuntimePlayer, nowMs: number): boolean {
  if (nowMs - player.messageWindowStartedAtMs >= 1_000) {
    player.messageWindowStartedAtMs = nowMs;
    player.messagesInWindow = 0;
  }
  player.messagesInWindow += 1;
  return player.messagesInWindow <= 90;
}

function spawnPoint(index: number): { readonly x: number; readonly z: number } {
  const points = [
    { x: -18, z: -18 }, { x: 18, z: 18 }, { x: -18, z: 18 }, { x: 18, z: -18 },
    { x: 0, z: -18 }, { x: 0, z: 18 }, { x: -18, z: 0 }, { x: 18, z: 0 },
  ];
  return points[index % points.length] ?? points[0]!;
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}