# BattlePrompt Game

This directory is the complete mutable game project and the intended root of each public per-room game repository. Changes proposed by players or coding agents are restricted to this tree.

## Contents

- `client/`: sandboxed Babylon.js browser client, rendering, input, prediction, and effects.
- `server/`: authoritative movement, combat, respawn, and snapshot simulation.
- `shared/`: map geometry, collision, and raycast logic used by both runtimes.

The repository is standalone and described by `battleprompt.game.json`. A compatible replacement game may use any internal structure as long as the manifest commands install, build, and start one HTTP process that serves the browser client, readiness endpoint, and room WebSocket endpoint.

Controls: use `W`, `A`, `S`, and `D` to move, `Space` to jump, the mouse to aim, and the primary mouse button to fire.

The game calls the scoped runtime bridge supplied through environment variables and has no dependency on BattlePrompt's platform workspace. It must not import room-service implementations, persistence code, Git credentials, or infrastructure APIs. Local development runs this process as a child; production will run the same manifest in a disposable Fly Machine.
