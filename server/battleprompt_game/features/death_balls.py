from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from ..arena import collides_with_arena
from ..feature_api import GameFeature

DEATH_BALL_SPEED = 3.8
DEATH_BALL_RADIUS = 0.75


@dataclass
class DeathBall:
    x: float
    z: float
    rotation: float = 0


def _death_ball(room: Any) -> DeathBall:
    ball = room.feature_state.get("deathBall")
    if isinstance(ball, DeathBall):
        return ball
    ball = DeathBall(*_random_ball_spawn())
    room.feature_state["deathBall"] = ball
    return ball


def advance_death_ball(room: Any, now_ms: int) -> None:
    ball = _death_ball(room)
    living = [player for player in room.players.values() if player.respawn_at_ms is None]
    if not living:
        return
    target = min(living, key=lambda player: math.hypot(player.x - ball.x, player.z - ball.z))
    distance = math.hypot(target.x - ball.x, target.z - ball.z)
    if distance <= DEATH_BALL_RADIUS:
        target.health = 0
        target.respawn_at_ms = now_ms + room.config["respawnSeconds"] * 1_000
        ball.x, ball.z = _random_ball_spawn()
        return
    step = min(DEATH_BALL_SPEED / 60, distance)
    next_x = ball.x + (target.x - ball.x) / distance * step
    next_z = ball.z + (target.z - ball.z) / distance * step
    if not collides_with_arena(next_x, next_z):
        ball.x, ball.z = next_x, next_z
    else:
        ball.x, ball.z = _random_ball_spawn()
    ball.rotation += step / DEATH_BALL_RADIUS


def death_ball_snapshot(room: Any) -> dict[str, Any]:
    ball = _death_ball(room)
    return {"deathBall": {"x": ball.x, "z": ball.z, "rotation": ball.rotation}}


def _random_ball_spawn() -> tuple[float, float]:
    for _ in range(100):
        x = random.uniform(-22, 22)
        z = random.uniform(-22, 22)
        if not collides_with_arena(x, z):
            return x, z
    return 0, 0


feature = GameFeature(simulate=advance_death_ball, room_snapshot=death_ball_snapshot)