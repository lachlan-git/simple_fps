export interface ArenaObstacle {
    readonly id: string;
    readonly kind: "wall" | "cover" | "crate" | "pillar";
    readonly x: number;
    readonly z: number;
    readonly width: number;
    readonly depth: number;
    readonly height: number;
}
export declare const ARENA_HALF_SIZE = 25;
export declare const PLAYER_RADIUS = 0.45;
export declare const PLAYER_EYE_HEIGHT = 1.7;
export declare const PLAYER_HEIGHT = 2.15;
export declare const ARENA_OBSTACLES: readonly ArenaObstacle[];
export interface VectorLike {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
export declare function collidesWithArena(x: number, z: number, radius?: number): boolean;
export declare function raycastArena(origin: VectorLike, direction: VectorLike, maximumDistance: number): number | null;
export declare function raycastPlayer(origin: VectorLike, direction: VectorLike, playerPosition: VectorLike, maximumDistance: number): number | null;
