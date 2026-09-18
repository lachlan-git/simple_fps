from __future__ import annotations

from dataclasses import dataclass
from importlib import import_module
from pkgutil import iter_modules
from typing import Any, Callable


def _noop(*_args: Any) -> None:
    pass


def _allow_shot(_player: Any, _now_ms: int) -> bool:
    return True


def _empty_snapshot(_value: Any) -> dict[str, Any]:
    return {}


@dataclass(frozen=True)
class GameFeature:
    on_player_created: Callable[[Any], None] = _noop
    on_player_respawn: Callable[[Any], None] = _noop
    can_shoot: Callable[[Any, int], bool] = _allow_shot
    on_shot: Callable[[Any], None] = _noop
    on_elimination: Callable[[Any, Any, Any, int], None] = _noop
    simulate: Callable[[Any, int], None] = _noop
    room_snapshot: Callable[[Any], dict[str, Any]] = _empty_snapshot
    player_snapshot: Callable[[Any], dict[str, Any]] = _empty_snapshot


def load_features() -> tuple[GameFeature, ...]:
    from . import features

    loaded = []
    modules = sorted(iter_modules(features.__path__), key=lambda item: item.name)
    for module_info in modules:
        module = import_module(f"{features.__name__}.{module_info.name}")
        feature = getattr(module, "feature", None)
        if not isinstance(feature, GameFeature):
            raise RuntimeError(f"Feature module {module_info.name} does not export a GameFeature")
        loaded.append(feature)
    return tuple(loaded)