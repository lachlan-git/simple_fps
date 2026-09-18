from pathlib import Path

from fastapi.testclient import TestClient

from server.battleprompt_game.app import GameSettings, build_game_app
from server.battleprompt_game.arena import collides_with_arena, raycast_arena, raycast_player


CONFIG = {
    "maxPlayers": 3, "warmupSeconds": 10, "roundSeconds": 30,
    "finalVoteSeconds": 5, "activationSeconds": 2, "candidateWaitSeconds": 0,
    "respawnSeconds": 2, "startingHealth": 80, "weaponDamage": 40, "maxPointsPerCall": 2,
}


class FakeControlPlane:
    def __init__(self):
        self.room = {
            "state": {"config": CONFIG, "phase": "WARMUP", "deadlineMs": None},
            "players": [{"id": "player_1", "displayName": "Delta", "points": 0}],
        }

    async def start(self): pass
    async def close(self): pass
    async def authenticate_player(self, code, token):
        if code != "ABC234" or token != "x" * 32:
            raise RuntimeError("invalid")
        return self.room["players"][0]
    def get_room(self, code): return self.room
    async def add_points(self, code, player_id, points): self.room["players"][0]["points"] += points


def test_map_collision_and_raycast_match_typescript() -> None:
    assert collides_with_arena(-17, -16)
    assert not collides_with_arena(0, 0)
    assert raycast_arena({"x": -5, "y": 1.7, "z": 0}, {"x": 0, "y": 0, "z": -1}, 30) == 9.5
    assert raycast_player({"x": 0, "y": 1.7, "z": 0}, {"x": 0, "y": 0, "z": 1}, {"x": 2, "y": 1.7, "z": 20}, 30) is None


def test_game_runtime_authenticates_and_publishes_snapshots(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<main>game</main>")
    app = build_game_app(GameSettings(
        room_code="ABC234", runtime_id="runtime_test", runtime_token="r" * 32,
        control_url="http://control", control_origin="http://localhost:5173",
        public_url="http://localhost:4100/", client_root=tmp_path,
    ), FakeControlPlane())
    with TestClient(app) as client:
        assert client.get("/health/ready").json() == {"status": "ready"}
        with client.websocket_connect("/ws/game/ABC234") as socket:
            socket.send_json({"type": "authenticate", "token": "x" * 32})
            authenticated = socket.receive_json()
            assert authenticated["type"] == "authenticated"
            snapshot = socket.receive_json()
            assert snapshot["type"] == "snapshot"
            assert snapshot["players"][0]["displayName"] == "Delta"