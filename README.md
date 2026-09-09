# BattlePrompt Game

This directory is the complete mutable game project and the intended root of each public per-room game repository. Changes proposed by players or coding agents are restricted to this tree.

## Contents

- `client/`: sandboxed Babylon.js browser client, rendering, input, prediction, and effects.
- `server/`: authoritative movement, combat, respawn, and snapshot simulation.
- `shared/`: map geometry, collision, and raycast logic used by both runtimes.

The game may consume the versioned `@battleprompt/contracts` boundary package. It must not import trusted room-service implementations, persistence code, host credentials, Git credentials, or infrastructure APIs. The server exposes only the `GameControlPlane` interface it needs from the trusted platform.

In local development, the trusted API loads `@battleprompt/game-server` in-process for convenience. Production must build this directory from the selected room revision and run the server artifact in an isolated workload on a separate origin.
