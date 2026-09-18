from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import uvicorn

from .app import GameSettings, build_game_app


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def settings_from_environment() -> GameSettings:
    public_url = _required("BATTLEPROMPT_PUBLIC_URL")
    if urlparse(public_url).scheme not in {"http", "https"}:
        raise RuntimeError("BATTLEPROMPT_PUBLIC_URL is invalid")
    return GameSettings(
        room_code=_required("BATTLEPROMPT_ROOM_CODE").strip().upper(),
        runtime_id=_required("BATTLEPROMPT_RUNTIME_ID"),
        runtime_token=_required("BATTLEPROMPT_RUNTIME_TOKEN"),
        control_url=_required("BATTLEPROMPT_CONTROL_URL"),
        control_origin=_required("BATTLEPROMPT_CONTROL_ORIGIN"),
        public_url=public_url,
        client_root=Path("client/dist").resolve(),
    )


def main() -> None:
    port = int(_required("PORT"))
    uvicorn.run(build_game_app(settings_from_environment()), host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()