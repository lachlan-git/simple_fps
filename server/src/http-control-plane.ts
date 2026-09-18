import { z } from "zod";

import type { ControlPlanePlayer, ControlPlaneRoom, GameControlPlane } from "./game-runtime.js";

const PlayerSchema = z.object({
  id: z.string().min(1).max(64),
  displayName: z.string(),
  points: z.number(),
}).strip();

const RoomConfigSchema = z.object({
  maxPlayers: z.number().int().positive(),
  warmupSeconds: z.number().int().nonnegative(),
  roundSeconds: z.number().int().positive(),
  finalVoteSeconds: z.number().int().nonnegative(),
  activationSeconds: z.number().int().nonnegative(),
  candidateWaitSeconds: z.number().int().nonnegative(),
  respawnSeconds: z.number().int().positive(),
  startingHealth: z.number().int().positive(),
  weaponDamage: z.number().int().positive(),
  maxPointsPerCall: z.number().int().positive(),
}).strip();

const RoomSchema = z.object({
  state: z.object({
    config: RoomConfigSchema,
    phase: z.string(),
    deadlineMs: z.number().nullable(),
  }).strip(),
  players: z.array(PlayerSchema),
}).strip();

const AuthenticationSchema = z.object({
  player: PlayerSchema,
  room: RoomSchema,
}).strict();

export class HttpGameControlPlane implements GameControlPlane {
  readonly #rooms = new Map<string, ControlPlaneRoom>();
  readonly #refreshInterval: NodeJS.Timeout;

  public constructor(
    private readonly controlUrl: URL,
    private readonly runtimeId: string,
    private readonly runtimeToken: string,
    private readonly roomCode: string,
  ) {
    this.#refreshInterval = setInterval(() => void this.#refreshRoom(), 250);
    this.#refreshInterval.unref();
  }

  public async authenticatePlayer(code: string, token: string): Promise<ControlPlanePlayer> {
    this.#requireRoom(code);
    const response = AuthenticationSchema.parse(await this.#request("authenticate", {
      method: "POST",
      body: JSON.stringify({ gameToken: token }),
    }));
    this.#rooms.set(code, response.room);
    return response.player;
  }

  public getRoom(code: string): ControlPlaneRoom {
    this.#requireRoom(code);
    const room = this.#rooms.get(code);
    if (room === undefined) throw new Error("Room state is not available");
    return room;
  }

  public async addPoints(code: string, playerId: string, points: number): Promise<void> {
    this.#requireRoom(code);
    const room = RoomSchema.parse(await this.#request("points", {
      method: "POST",
      body: JSON.stringify({ playerId, points }),
    }));
    this.#rooms.set(code, room);
  }

  public close(): void {
    clearInterval(this.#refreshInterval);
  }

  async #refreshRoom(): Promise<void> {
    if (!this.#rooms.has(this.roomCode)) return;
    try {
      const room = RoomSchema.parse(await this.#request("room"));
      this.#rooms.set(this.roomCode, room);
    } catch {}
  }

  async #request(action: "authenticate" | "points" | "room", init?: RequestInit): Promise<unknown> {
    const response = await fetch(new URL(
      `/internal/runtimes/${encodeURIComponent(this.runtimeId)}/${action}`,
      this.controlUrl,
    ), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.runtimeToken}`,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`Control plane returned ${response.status}`);
    return response.json();
  }

  #requireRoom(code: string): void {
    if (code.trim().toUpperCase() !== this.roomCode) throw new Error("Runtime is bound to another room");
  }
}