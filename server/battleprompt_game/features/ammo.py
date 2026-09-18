from __future__ import annotations

from typing import Any

from ..feature_api import GameFeature

SPAWN_AMMO = 6


def reset_ammo(player: Any) -> None:
    player.feature_state["ammo"] = SPAWN_AMMO


def has_ammo(player: Any, _now_ms: int) -> bool:
    return int(player.feature_state.get("ammo", 0)) > 0


def consume_ammo(player: Any) -> None:
    player.feature_state["ammo"] = max(0, int(player.feature_state.get("ammo", 0)) - 1)


def ammo_snapshot(player: Any) -> dict[str, int]:
    return {"ammo": int(player.feature_state.get("ammo", 0))}


feature = GameFeature(
    on_player_created=reset_ammo,
    on_player_respawn=reset_ammo,
    can_shoot=has_ammo,
    on_shot=consume_ammo,
    player_snapshot=ammo_snapshot,
)