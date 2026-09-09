export const ARENA_HALF_SIZE = 25;
export const PLAYER_RADIUS = 0.45;
export const PLAYER_EYE_HEIGHT = 1.7;
export const PLAYER_HEIGHT = 2.15;
export const ARENA_OBSTACLES = Object.freeze([
    { id: "north-wall", kind: "wall", x: 0, z: -25, width: 50, depth: 1, height: 4 },
    { id: "south-wall", kind: "wall", x: 0, z: 25, width: 50, depth: 1, height: 4 },
    { id: "west-wall", kind: "wall", x: -25, z: 0, width: 1, depth: 50, height: 4 },
    { id: "east-wall", kind: "wall", x: 25, z: 0, width: 1, depth: 50, height: 4 },
    { id: "north-divider-west", kind: "wall", x: -8, z: -10, width: 16, depth: 1, height: 4 },
    { id: "north-divider-east", kind: "wall", x: 8, z: -10, width: 8, depth: 1, height: 4 },
    { id: "south-divider-west", kind: "wall", x: -8, z: 10, width: 8, depth: 1, height: 4 },
    { id: "south-divider-east", kind: "wall", x: 8, z: 10, width: 16, depth: 1, height: 4 },
    { id: "west-divider-north", kind: "wall", x: -10, z: -5, width: 1, depth: 10, height: 4 },
    { id: "west-divider-south", kind: "wall", x: -10, z: 8, width: 1, depth: 6, height: 4 },
    { id: "east-divider-north", kind: "wall", x: 10, z: -8, width: 1, depth: 6, height: 4 },
    { id: "east-divider-south", kind: "wall", x: 10, z: 5, width: 1, depth: 10, height: 4 },
    { id: "central-cover-a", kind: "cover", x: -3.5, z: -2.5, width: 3, depth: 1.2, height: 1.4 },
    { id: "central-cover-b", kind: "cover", x: 4, z: 3, width: 1.2, depth: 4, height: 1.4 },
    { id: "north-crate-a", kind: "crate", x: -17, z: -16, width: 2.4, depth: 2.4, height: 2.4 },
    { id: "north-crate-b", kind: "crate", x: -14.2, z: -16, width: 2.4, depth: 2.4, height: 1.4 },
    { id: "south-crate-a", kind: "crate", x: 17, z: 16, width: 2.4, depth: 2.4, height: 2.4 },
    { id: "south-crate-b", kind: "crate", x: 14.2, z: 16, width: 2.4, depth: 2.4, height: 1.4 },
    { id: "west-pillar", kind: "pillar", x: -18, z: 5, width: 1.8, depth: 1.8, height: 3.4 },
    { id: "east-pillar", kind: "pillar", x: 18, z: -5, width: 1.8, depth: 1.8, height: 3.4 },
]);
export function collidesWithArena(x, z, radius = PLAYER_RADIUS) {
    return ARENA_OBSTACLES.some((obstacle) => x + radius > obstacle.x - obstacle.width / 2
        && x - radius < obstacle.x + obstacle.width / 2
        && z + radius > obstacle.z - obstacle.depth / 2
        && z - radius < obstacle.z + obstacle.depth / 2);
}
export function raycastArena(origin, direction, maximumDistance) {
    let nearest = null;
    for (const obstacle of ARENA_OBSTACLES) {
        const distance = rayBoxDistance(origin, direction, {
            minimumX: obstacle.x - obstacle.width / 2,
            maximumX: obstacle.x + obstacle.width / 2,
            minimumY: 0,
            maximumY: obstacle.height,
            minimumZ: obstacle.z - obstacle.depth / 2,
            maximumZ: obstacle.z + obstacle.depth / 2,
        });
        if (distance !== null && distance <= maximumDistance && (nearest === null || distance < nearest)) {
            nearest = distance;
        }
    }
    return nearest;
}
export function raycastPlayer(origin, direction, playerPosition, maximumDistance) {
    const groundY = playerPosition.y - PLAYER_EYE_HEIGHT;
    const distance = rayBoxDistance(origin, direction, {
        minimumX: playerPosition.x - PLAYER_RADIUS,
        maximumX: playerPosition.x + PLAYER_RADIUS,
        minimumY: groundY,
        maximumY: groundY + PLAYER_HEIGHT,
        minimumZ: playerPosition.z - PLAYER_RADIUS,
        maximumZ: playerPosition.z + PLAYER_RADIUS,
    });
    return distance !== null && distance <= maximumDistance ? distance : null;
}
function rayBoxDistance(origin, direction, bounds) {
    let minimumDistance = 0;
    let maximumDistance = Number.POSITIVE_INFINITY;
    for (const [originValue, directionValue, minimum, maximum] of [
        [origin.x, direction.x, bounds.minimumX, bounds.maximumX],
        [origin.y, direction.y, bounds.minimumY, bounds.maximumY],
        [origin.z, direction.z, bounds.minimumZ, bounds.maximumZ],
    ]) {
        if (Math.abs(directionValue) < 1e-8) {
            if (originValue < minimum || originValue > maximum)
                return null;
            continue;
        }
        const first = (minimum - originValue) / directionValue;
        const second = (maximum - originValue) / directionValue;
        minimumDistance = Math.max(minimumDistance, Math.min(first, second));
        maximumDistance = Math.min(maximumDistance, Math.max(first, second));
        if (maximumDistance < minimumDistance)
            return null;
    }
    return maximumDistance >= 0 ? minimumDistance : null;
}
