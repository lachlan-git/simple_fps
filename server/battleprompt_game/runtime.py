from __future__ import annotations

import asyncio
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from typing_extensions import Annotated, Literal

from .arena import PLAYER_EYE_HEIGHT, collides_with_arena, raycast_arena, raycast_player
from .control_plane import ControlPlane

SIMULATION_HZ = 60
PLAYER_SPEED = 6
JUMP_SPEED = 7.5
GRAVITY = 20


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuthenticateMessage(Message):
    type: Literal["authenticate"]
    token: Annotated[str, Field(min_length=32, max_length=2_048)]


class InputMessage(Message):
    type: Literal["input"]
    forward: Annotated[float, Field(ge=-1, le=1)]
    strafe: Annotated[float, Field(ge=-1, le=1)]
    jump: bool
    yaw: float
    pitch: Annotated[float, Field(ge=-1.5, le=1.5)]


class ShootMessage(Message):
    type: Literal["shoot"]
    yaw: float
    pitch: Annotated[float, Field(ge=-1.5, le=1.5)]


MESSAGE_ADAPTER = TypeAdapter(Annotated[AuthenticateMessage | InputMessage | ShootMessage, Field(discriminator="type")])


@dataclass
class RuntimePlayer:
    id: str
    display_name: str
    socket: WebSocket
    x: float
    y: float
    z: float
    yaw: float
    pitch: float
    health: int
    respawn_at_ms: int | None = None
    forward: float = 0
    strafe: float = 0
    jump_queued: bool = False
    vertical_velocity: float = 0
    last_shot_at_ms: int = 0
    message_window_started_at_ms: int = field(default_factory=lambda: int(time.time() * 1_000))
    messages_in_window: int = 0


@dataclass
class GameRoom:
    code: str
    config: dict[str, Any]
    players: dict[str, RuntimePlayer] = field(default_factory=dict)
    tick: int = 0


class GameRuntime:
    def __init__(self, control_plane: ControlPlane) -> None:
        self.control_plane = control_plane
        self.rooms: dict[str, GameRoom] = {}
        self._simulation_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        await self.control_plane.start()
        self._simulation_task = asyncio.create_task(self._simulation_loop())

    async def accept(self, socket: WebSocket, code_input: str) -> None:
        code = code_input.strip().upper()
        await socket.accept()
        player: RuntimePlayer | None = None
        try:
            raw = await asyncio.wait_for(socket.receive_text(), timeout=5)
            message = _message(raw)
            if not isinstance(message, AuthenticateMessage):
                await socket.close(4401, "Authentication required")
                return
            identity = await self.control_plane.authenticate_player(code, message.token)
            room_snapshot = self.control_plane.get_room(code)
            room = self.rooms.setdefault(code, GameRoom(code, room_snapshot["state"]["config"]))
            room.config = room_snapshot["state"]["config"]
            previous = room.players.get(identity["id"])
            if previous is not None:
                await previous.socket.close(4409, "Connected elsewhere")
            player = _create_player(identity, socket, room.config, len(room.players))
            room.players[player.id] = player
            await socket.send_json({"type": "authenticated", "playerId": player.id, "config": room.config})

            while True:
                raw = await socket.receive_text()
                try:
                    message = _message(raw)
                except ValueError:
                    await socket.close(4400, "Invalid message")
                    return
                now_ms = int(time.time() * 1_000)
                if not _allow_message(player, now_ms):
                    await socket.close(4429, "Rate limit exceeded")
                    return
                if isinstance(message, InputMessage):
                    player.forward = message.forward
                    player.strafe = message.strafe
                    player.jump_queued = player.jump_queued or message.jump
                    player.yaw = math.atan2(math.sin(message.yaw), math.cos(message.yaw))
                    player.pitch = message.pitch
                elif isinstance(message, ShootMessage):
                    await self._shoot(room, player, message.yaw, message.pitch, now_ms)
        except TimeoutError:
            await socket.close(4401, "Authentication required")
        except (WebSocketDisconnect, RuntimeError):
            pass
        except ValueError:
            await socket.close(4400, "Invalid message")
        finally:
            if player is not None and self.rooms.get(code, GameRoom(code, {})).players.get(player.id) is player:
                self.rooms[code].players.pop(player.id, None)

    async def close(self) -> None:
        if self._simulation_task is not None:
            self._simulation_task.cancel()
            await asyncio.gather(self._simulation_task, return_exceptions=True)
        await self.control_plane.close()
        for room in self.rooms.values():
            for player in room.players.values():
                await player.socket.close(1001, "Server shutting down")

    async def _simulation_loop(self) -> None:
        interval = 1 / SIMULATION_HZ
        while True:
            started = asyncio.get_running_loop().time()
            await self._simulate(int(time.time() * 1_000))
            await asyncio.sleep(max(0, interval - (asyncio.get_running_loop().time() - started)))

    async def _simulate(self, now_ms: int) -> None:
        for room in self.rooms.values():
            room.tick += 1
            for player in room.players.values():
                if player.respawn_at_ms is not None:
                    if now_ms >= player.respawn_at_ms:
                        spawn = _spawn_point(len(room.players) + room.tick)
                        player.x, player.y, player.z = spawn[0], PLAYER_EYE_HEIGHT, spawn[1]
                        player.yaw = math.atan2(-spawn[0], -spawn[1])
                        player.pitch = 0
                        player.health = room.config["startingHealth"]
                        player.respawn_at_ms = None
                        player.jump_queued = False
                        player.vertical_velocity = 0
                    continue
                speed = PLAYER_SPEED / SIMULATION_HZ
                input_length = math.hypot(player.forward, player.strafe) or 1
                forward = player.forward / max(1, input_length)
                strafe = player.strafe / max(1, input_length)
                next_x = max(-23, min(23, player.x + (math.sin(player.yaw) * forward + math.cos(player.yaw) * strafe) * speed))
                next_z = max(-23, min(23, player.z + (math.cos(player.yaw) * forward - math.sin(player.yaw) * strafe) * speed))
                if not collides_with_arena(next_x, player.z):
                    player.x = next_x
                if not collides_with_arena(player.x, next_z):
                    player.z = next_z
                if player.jump_queued and player.y <= PLAYER_EYE_HEIGHT:
                    player.vertical_velocity = JUMP_SPEED
                player.jump_queued = False
                player.vertical_velocity -= GRAVITY / SIMULATION_HZ
                player.y += player.vertical_velocity / SIMULATION_HZ
                if player.y <= PLAYER_EYE_HEIGHT:
                    player.y = PLAYER_EYE_HEIGHT
                    player.vertical_velocity = 0
            snapshot = self.control_plane.get_room(room.code)
            await self._broadcast(room, {
                "type": "snapshot", "tick": room.tick,
                "phase": snapshot["state"]["phase"], "deadlineMs": snapshot["state"]["deadlineMs"],
                "scores": snapshot["players"],
                "players": [_public_runtime_player(item) for item in room.players.values()],
            })

    async def _shoot(self, room: GameRoom, attacker: RuntimePlayer, yaw: float, pitch: float, now_ms: int) -> None:
        if attacker.respawn_at_ms is not None or now_ms - attacker.last_shot_at_ms < 250:
            return
        attacker.last_shot_at_ms = now_ms
        direction = {
            "x": math.sin(yaw) * math.cos(pitch),
            "y": -math.sin(pitch),
            "z": math.cos(yaw) * math.cos(pitch),
        }
        origin = {"x": attacker.x, "y": attacker.y, "z": attacker.z}
        obstacle_distance = raycast_arena(origin, direction, 30) or 30
        target = None
        target_distance = math.inf
        for candidate in room.players.values():
            if candidate.id == attacker.id or candidate.respawn_at_ms is not None:
                continue
            distance = raycast_player(origin, direction, candidate, obstacle_distance)
            if distance is not None and distance < target_distance:
                target, target_distance = candidate, distance
        end = (
            {"x": origin["x"] + direction["x"] * obstacle_distance, "y": origin["y"] + direction["y"] * obstacle_distance, "z": origin["z"] + direction["z"] * obstacle_distance}
            if target is None else {"x": target.x, "y": target.y, "z": target.z}
        )
        eliminated = False
        if target is not None:
            target.health = max(0, target.health - room.config["weaponDamage"])
            eliminated = target.health == 0
        await self._broadcast(room, {
            "type": "shot", "attackerId": attacker.id, "victimId": target.id if target else None,
            "origin": origin, "end": end, "damage": 0 if target is None else room.config["weaponDamage"],
            "eliminated": eliminated,
        })
        if target is not None and eliminated:
            target.respawn_at_ms = now_ms + room.config["respawnSeconds"] * 1_000
            asyncio.create_task(self.control_plane.add_points(room.code, attacker.id, 1))

    async def _broadcast(self, room: GameRoom, message: dict[str, Any]) -> None:
        results = await asyncio.gather(
            *(player.socket.send_json(message) for player in room.players.values()), return_exceptions=True,
        )
        del results


def _message(raw: str) -> AuthenticateMessage | InputMessage | ShootMessage:
    if len(raw.encode()) > 4_096:
        raise ValueError("Message too large")
    try:
        return MESSAGE_ADAPTER.validate_python(json.loads(raw))
    except (json.JSONDecodeError, ValidationError) as error:
        raise ValueError("Invalid message") from error


def _create_player(identity: dict[str, Any], socket: WebSocket, config: dict[str, Any], index: int) -> RuntimePlayer:
    x, z = _spawn_point(index)
    return RuntimePlayer(
        id=identity["id"], display_name=identity["displayName"], socket=socket,
        x=x, y=PLAYER_EYE_HEIGHT, z=z, yaw=math.atan2(-x, -z), pitch=0,
        health=config["startingHealth"],
    )


def _allow_message(player: RuntimePlayer, now_ms: int) -> bool:
    if now_ms - player.message_window_started_at_ms >= 1_000:
        player.message_window_started_at_ms = now_ms
        player.messages_in_window = 0
    player.messages_in_window += 1
    return player.messages_in_window <= 90


def _spawn_point(index: int) -> tuple[int, int]:
    points = ((-18, -18), (18, 18), (-18, 18), (18, -18), (0, -18), (0, 18), (-18, 0), (18, 0))
    return points[index % len(points)]


def _public_runtime_player(player: RuntimePlayer) -> dict[str, Any]:
    return {
        "id": player.id, "displayName": player.display_name,
        "x": player.x, "y": player.y, "z": player.z,
        "yaw": player.yaw, "pitch": player.pitch,
        "health": player.health, "respawnAtMs": player.respawn_at_ms,
    }