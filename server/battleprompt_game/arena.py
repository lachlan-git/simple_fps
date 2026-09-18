from __future__ import annotations

from dataclasses import dataclass
from math import inf

ARENA_HALF_SIZE = 25
PLAYER_RADIUS = 0.45
PLAYER_EYE_HEIGHT = 1.7
PLAYER_HEIGHT = 2.15


@dataclass(frozen=True)
class Obstacle:
    id: str
    kind: str
    x: float
    z: float
    width: float
    depth: float
    height: float


OBSTACLES = (
    Obstacle("north-wall", "wall", 0, -25, 50, 1, 4),
    Obstacle("south-wall", "wall", 0, 25, 50, 1, 4),
    Obstacle("west-wall", "wall", -25, 0, 1, 50, 4),
    Obstacle("east-wall", "wall", 25, 0, 1, 50, 4),
    Obstacle("north-divider-west", "wall", -8, -10, 16, 1, 4),
    Obstacle("north-divider-east", "wall", 8, -10, 8, 1, 4),
    Obstacle("south-divider-west", "wall", -8, 10, 8, 1, 4),
    Obstacle("south-divider-east", "wall", 8, 10, 16, 1, 4),
    Obstacle("west-divider-north", "wall", -10, -5, 1, 10, 4),
    Obstacle("west-divider-south", "wall", -10, 8, 1, 6, 4),
    Obstacle("east-divider-north", "wall", 10, -8, 1, 6, 4),
    Obstacle("east-divider-south", "wall", 10, 5, 1, 10, 4),
    Obstacle("central-cover-a", "cover", -3.5, -2.5, 3, 1.2, 1.4),
    Obstacle("central-cover-b", "cover", 4, 3, 1.2, 4, 1.4),
    Obstacle("north-crate-a", "crate", -17, -16, 2.4, 2.4, 2.4),
    Obstacle("north-crate-b", "crate", -14.2, -16, 2.4, 2.4, 1.4),
    Obstacle("south-crate-a", "crate", 17, 16, 2.4, 2.4, 2.4),
    Obstacle("south-crate-b", "crate", 14.2, 16, 2.4, 2.4, 1.4),
    Obstacle("west-pillar", "pillar", -18, 5, 1.8, 1.8, 3.4),
    Obstacle("east-pillar", "pillar", 18, -5, 1.8, 1.8, 3.4),
)


def collides_with_arena(x: float, z: float, radius: float = PLAYER_RADIUS) -> bool:
    return any(
        x + radius > obstacle.x - obstacle.width / 2
        and x - radius < obstacle.x + obstacle.width / 2
        and z + radius > obstacle.z - obstacle.depth / 2
        and z - radius < obstacle.z + obstacle.depth / 2
        for obstacle in OBSTACLES
    )


def raycast_arena(origin: dict[str, float], direction: dict[str, float], maximum_distance: float) -> float | None:
    nearest = None
    for obstacle in OBSTACLES:
        distance = _ray_box_distance(origin, direction, (
            obstacle.x - obstacle.width / 2, obstacle.x + obstacle.width / 2,
            0, obstacle.height,
            obstacle.z - obstacle.depth / 2, obstacle.z + obstacle.depth / 2,
        ))
        if distance is not None and distance <= maximum_distance and (nearest is None or distance < nearest):
            nearest = distance
    return nearest


def raycast_player(
    origin: dict[str, float], direction: dict[str, float], player: object, maximum_distance: float,
) -> float | None:
    x = _coordinate(player, "x")
    y = _coordinate(player, "y")
    z = _coordinate(player, "z")
    ground_y = y - PLAYER_EYE_HEIGHT
    distance = _ray_box_distance(origin, direction, (
        x - PLAYER_RADIUS, x + PLAYER_RADIUS,
        ground_y, ground_y + PLAYER_HEIGHT,
        z - PLAYER_RADIUS, z + PLAYER_RADIUS,
    ))
    return distance if distance is not None and distance <= maximum_distance else None


def _ray_box_distance(
    origin: dict[str, float], direction: dict[str, float], bounds: tuple[float, ...],
) -> float | None:
    minimum_distance = 0.0
    maximum_distance = inf
    for origin_value, direction_value, minimum, maximum in (
        (origin["x"], direction["x"], bounds[0], bounds[1]),
        (origin["y"], direction["y"], bounds[2], bounds[3]),
        (origin["z"], direction["z"], bounds[4], bounds[5]),
    ):
        if abs(direction_value) < 1e-8:
            if origin_value < minimum or origin_value > maximum:
                return None
            continue
        first = (minimum - origin_value) / direction_value
        second = (maximum - origin_value) / direction_value
        minimum_distance = max(minimum_distance, min(first, second))
        maximum_distance = min(maximum_distance, max(first, second))
        if maximum_distance < minimum_distance:
            return None
    return minimum_distance if maximum_distance >= 0 else None


def _coordinate(value: object, name: str) -> float:
    if isinstance(value, dict):
        return float(value[name])
    return float(getattr(value, name))