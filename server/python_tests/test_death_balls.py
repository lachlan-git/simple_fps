from types import SimpleNamespace

from server.battleprompt_game.features.death_balls import DeathBall, advance_death_ball


def test_death_ball_targets_closest_player_and_eliminates_on_contact() -> None:
    closest = SimpleNamespace(x=0.5, z=0, health=80, respawn_at_ms=None)
    farther = SimpleNamespace(x=10, z=0, health=80, respawn_at_ms=None)
    room = SimpleNamespace(
        config={"respawnSeconds": 2},
        players={"closest": closest, "farther": farther},
        feature_state={"deathBall": DeathBall(0, 0)},
    )

    advance_death_ball(room, 5_000)

    assert closest.health == 0
    assert closest.respawn_at_ms == 7_000
    assert farther.health == 80