from types import SimpleNamespace

from server.battleprompt_game.features.health_packs import HealthPack, collect_health_packs


def test_health_pack_heals_an_injured_living_player() -> None:
    player = SimpleNamespace(x=2, z=3, health=40, respawn_at_ms=None)
    room = SimpleNamespace(
        config={"startingHealth": 80},
        players={"player_1": player},
        feature_state={"healthPacks": {"pack_1": HealthPack("pack_1", 2.5, 3)}},
    )

    collect_health_packs(room, 5_000)

    assert player.health == 75
    assert room.feature_state["healthPacks"] == {}