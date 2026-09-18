from __future__ import annotations

import asyncio
from typing import Any, Protocol
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict


class ControlPlane(Protocol):
    async def authenticate_player(self, code: str, token: str) -> dict[str, Any]: ...
    def get_room(self, code: str) -> dict[str, Any]: ...
    async def add_points(self, code: str, player_id: str, points: int) -> None: ...
    async def start(self) -> None: ...
    async def close(self) -> None: ...


class PlayerModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    displayName: str
    points: int


class HttpGameControlPlane:
    def __init__(self, control_url: str, runtime_id: str, runtime_token: str, room_code: str) -> None:
        self.control_url = control_url.rstrip("/")
        self.runtime_id = runtime_id
        self.runtime_token = runtime_token
        self.room_code = room_code
        self.rooms: dict[str, dict[str, Any]] = {}
        self._refresh_task: asyncio.Task[None] | None = None
        self._client = httpx.AsyncClient(timeout=2)

    async def start(self) -> None:
        self._refresh_task = asyncio.create_task(self._refresh_loop())

    async def authenticate_player(self, code: str, token: str) -> dict[str, Any]:
        self._require_room(code)
        value = await self._request("authenticate", method="POST", json={"gameToken": token})
        player = PlayerModel.model_validate(value["player"]).model_dump()
        self.rooms[code] = _room(value["room"])
        return player

    def get_room(self, code: str) -> dict[str, Any]:
        self._require_room(code)
        if code not in self.rooms:
            raise RuntimeError("Room state is not available")
        return self.rooms[code]

    async def add_points(self, code: str, player_id: str, points: int) -> None:
        self._require_room(code)
        value = await self._request("points", method="POST", json={"playerId": player_id, "points": points})
        self.rooms[code] = _room(value)

    async def close(self) -> None:
        if self._refresh_task is not None:
            self._refresh_task.cancel()
            await asyncio.gather(self._refresh_task, return_exceptions=True)
        await self._client.aclose()

    async def _refresh_loop(self) -> None:
        while True:
            await asyncio.sleep(0.25)
            if self.room_code not in self.rooms:
                continue
            try:
                self.rooms[self.room_code] = _room(await self._request("room"))
            except Exception:
                pass

    async def _request(self, action: str, **kwargs: Any) -> Any:
        response = await self._client.request(
            kwargs.pop("method", "GET"),
            f"{self.control_url}/internal/runtimes/{quote(self.runtime_id)}/{action}",
            headers={"Authorization": f"Bearer {self.runtime_token}"},
            **kwargs,
        )
        response.raise_for_status()
        return response.json()

    def _require_room(self, code: str) -> None:
        if code.strip().upper() != self.room_code:
            raise RuntimeError("Runtime is bound to another room")


def _room(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("state"), dict) or not isinstance(value.get("players"), list):
        raise ValueError("Control plane returned an invalid room")
    config = value["state"].get("config")
    if not isinstance(config, dict):
        raise ValueError("Control plane returned an invalid room configuration")
    return value