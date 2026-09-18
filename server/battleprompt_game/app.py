from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .control_plane import ControlPlane, HttpGameControlPlane
from .runtime import GameRuntime


@dataclass(frozen=True)
class GameSettings:
    room_code: str
    runtime_id: str
    runtime_token: str
    control_url: str
    control_origin: str
    public_url: str
    client_root: Path


def build_game_app(settings: GameSettings, control_plane: ControlPlane | None = None) -> FastAPI:
    control = control_plane or HttpGameControlPlane(
        settings.control_url, settings.runtime_id, settings.runtime_token, settings.room_code,
    )
    runtime = GameRuntime(control)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await runtime.start()
        yield
        await runtime.close()

    app = FastAPI(title="BattlePrompt Game Runtime", lifespan=lifespan)
    app.state.runtime = runtime

    @app.middleware("http")
    async def runtime_headers(request: Request, call_next):
        response = await call_next(request)
        ws_origin = settings.public_url.replace("https://", "wss://").replace("http://", "ws://").split("/", 3)[0:3]
        ws_origin_value = "/".join(ws_origin)
        public_origin = "/".join(settings.public_url.split("/", 3)[0:3])
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Content-Security-Policy"] = "; ".join([
            "default-src 'none'", f"script-src {public_origin}",
            f"connect-src {public_origin} {ws_origin_value}", f"img-src {public_origin} data:",
            f"style-src {public_origin}", f"worker-src {public_origin} blob:",
            "object-src 'none'", "base-uri 'none'", "form-action 'none'",
            f"frame-ancestors {settings.control_origin}",
        ])
        response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health/ready")
    async def ready() -> JSONResponse:
        return JSONResponse({"status": "ready"}, headers={"Cache-Control": "no-store"})

    @app.websocket("/ws/game/{room_code}")
    async def game_socket(socket: WebSocket, room_code: str) -> None:
        if room_code.strip().upper() != settings.room_code:
            await socket.close(4404, "Room not found")
            return
        await runtime.accept(socket, room_code)

    app.mount("/", StaticFiles(directory=settings.client_root, html=True), name="client")
    return app