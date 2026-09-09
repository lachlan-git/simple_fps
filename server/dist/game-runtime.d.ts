import type { WebSocket } from "ws";
import type { PlayerId, RoomConfig } from "@battleprompt/contracts";
interface ControlPlanePlayer {
    readonly id: PlayerId;
    readonly displayName: string;
    readonly points: number;
}
interface ControlPlaneRoom {
    readonly state: {
        readonly config: RoomConfig;
        readonly phase: string;
        readonly deadlineMs: number | null;
    };
    readonly players: readonly ControlPlanePlayer[];
}
export interface GameControlPlane {
    authenticatePlayer(code: string, token: string): ControlPlanePlayer;
    getRoom(code: string, nowMs?: number): ControlPlaneRoom;
    addPoints(code: string, playerId: string, points: number, nowMs?: number): unknown;
}
export declare class GameRuntime {
    #private;
    private readonly controlPlane;
    constructor(controlPlane: GameControlPlane);
    accept(socket: WebSocket, codeInput: string): void;
    close(): void;
}
export {};
