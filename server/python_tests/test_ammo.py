from types import SimpleNamespace

from server.battleprompt_game.features.ammo import SPAWN_AMMO, consume_ammo, has_ammo, reset_ammo


def test_player_has_six_shots_and_ammo_resets_on_respawn() -> None:
    player = SimpleNamespace(feature_state={})
    reset_ammo(player)

    for _ in range(SPAWN_AMMO):
        assert has_ammo(player, 1_000)
        consume_ammo(player)

    assert not has_ammo(player, 2_000)
    reset_ammo(player)
    assert player.feature_state["ammo"] == SPAWN_AMMO