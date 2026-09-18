from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Any, cast

from ..feature_api import GameFeature

HEALTH_PACK_HEALING = 35
HEALTH_PACK_PICKUP_RADIUS = 1.25


@dataclass
class HealthPack:
    id: str
    x: float
    z: float


def _health_packs(room: Any) -> dict[str, HealthPack]:
    return cast(dict[str, HealthPack], room.feature_state.setdefault("healthPacks", {}))


def spawn_health_pack(room: Any, _attacker: Any, target: Any, _now_ms: int) -> None:
    pack = HealthPack(f"health_{uuid.uuid4()}", target.x, target.z)
    _health_packs(room)[pack.id] = pack


def collect_health_packs(room: Any, _now_ms: int) -> None:
    packs = _health_packs(room)
    for pack_id, pack in list(packs.items()):
        collector = next((
            player for player in room.players.values()
            if player.respawn_at_ms is None
            and player.health < room.config["startingHealth"]
            and math.hypot(player.x - pack.x, player.z - pack.z) <= HEALTH_PACK_PICKUP_RADIUS
        ), None)
        if collector is None:
            continue
        collector.health = min(room.config["startingHealth"], collector.health + HEALTH_PACK_HEALING)
        del packs[pack_id]


def health_pack_snapshot(room: Any) -> dict[str, Any]:
    return {
        "healthPacks": [
            {"id": pack.id, "x": pack.x, "z": pack.z}
            for pack in _health_packs(room).values()
        ],
    }


feature = GameFeature(
    on_elimination=spawn_health_pack,
    simulate=collect_health_packs,
    room_snapshot=health_pack_snapshot,
)