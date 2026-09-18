import {
  Color3,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { ARENA_OBSTACLES, PLAYER_EYE_HEIGHT, collidesWithArena } from "@battleprompt/game-shared";

import "./styles.css";

interface PlayerState {
  readonly id: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly health: number;
  readonly respawnAtMs: number | null;
}

interface ShotMessage {
  readonly type: "shot";
  readonly attackerId: string;
  readonly victimId: string | null;
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly end: { readonly x: number; readonly y: number; readonly z: number };
  readonly damage: number;
  readonly eliminated: boolean;
}

interface Avatar {
  readonly root: TransformNode;
  readonly leftLeg: Mesh;
  readonly rightLeg: Mesh;
  readonly leftArm: Mesh;
  readonly rightArm: Mesh;
  readonly muzzle: Mesh;
  readonly targetPosition: Vector3;
  targetYaw: number;
  previousX: number;
  previousZ: number;
  walkPhase: number;
  muzzleUntil: number;
}

interface Particle {
  readonly mesh: Mesh;
  readonly velocity: Vector3;
  readonly expiresAt: number;
}

const parentOrigin = import.meta.env.VITE_CONTROL_ORIGIN ?? "http://localhost:5173";
const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? location.origin;
const INPUT_HZ = 60;
const roomCode = new URLSearchParams(location.search).get("room");
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const hitMarker = document.querySelector<HTMLDivElement>("#hitmarker")!;
const damageOverlay = document.querySelector<HTMLDivElement>("#damage-overlay")!;
const killFeed = document.querySelector<HTMLDivElement>("#kill-feed")!;

const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
const scene = new Scene(engine);
scene.clearColor.set(0.055, 0.075, 0.066, 1);
scene.skipPointerMovePicking = true;

const camera = new UniversalCamera("player-camera", new Vector3(0, 1.7, -18), scene);
camera.minZ = 0.05;
camera.fov = 1.12;
camera.inputs.clear();
new HemisphericLight("sky-light", new Vector3(0.3, 1, 0.2), scene).intensity = 0.95;

const floorMaterial = material("floor", new Color3(0.19, 0.25, 0.21));
const wallMaterial = material("wall", new Color3(0.69, 0.66, 0.55));
const coverMaterial = material("cover", new Color3(0.18, 0.34, 0.27));
const crateMaterial = material("crate", new Color3(0.44, 0.31, 0.18));
const pillarMaterial = material("pillar", new Color3(0.36, 0.4, 0.36));
const bloodMaterial = material("blood", new Color3(0.65, 0.025, 0.015));
const sparkMaterial = emissiveMaterial("spark", new Color3(1, 0.68, 0.15));
const gunMaterial = material("gun", new Color3(0.08, 0.095, 0.085));

const floor = MeshBuilder.CreateGround("arena-floor", { width: 50, height: 50, subdivisions: 2 }, scene);
floor.material = floorMaterial;
for (const obstacle of ARENA_OBSTACLES) {
  const mesh = MeshBuilder.CreateBox(obstacle.id, {
    width: obstacle.width,
    depth: obstacle.depth,
    height: obstacle.height,
  }, scene);
  mesh.position.set(obstacle.x, obstacle.height / 2, obstacle.z);
  mesh.material = obstacle.kind === "wall"
    ? wallMaterial
    : obstacle.kind === "crate"
      ? crateMaterial
      : obstacle.kind === "pillar"
        ? pillarMaterial
        : coverMaterial;
}

for (const [x, z] of [[-20, -20], [20, 20], [-20, 20], [20, -20]] as const) {
  const pad = MeshBuilder.CreateCylinder(`spawn-${x}-${z}`, { diameter: 3, height: 0.06, tessellation: 24 }, scene);
  pad.position.set(x, 0.04, z);
  pad.material = emissiveMaterial(`spawn-material-${x}-${z}`, new Color3(0.08, 0.5, 0.32));
}

const weaponRoot = new TransformNode("first-person-weapon", scene);
weaponRoot.parent = camera;
weaponRoot.position.set(0.34, -0.28, 0.72);
const weaponBody = MeshBuilder.CreateBox("rifle-body", { width: 0.19, height: 0.18, depth: 0.62 }, scene);
weaponBody.parent = weaponRoot;
weaponBody.material = gunMaterial;
const weaponBarrel = MeshBuilder.CreateCylinder("rifle-barrel", { diameter: 0.055, height: 0.55, tessellation: 10 }, scene);
weaponBarrel.parent = weaponRoot;
weaponBarrel.rotation.x = Math.PI / 2;
weaponBarrel.position.set(0, 0.01, 0.46);
weaponBarrel.material = gunMaterial;
const firstPersonMuzzle = MeshBuilder.CreateSphere("first-person-muzzle", { diameter: 0.14, segments: 6 }, scene);
firstPersonMuzzle.parent = weaponRoot;
firstPersonMuzzle.position.set(0, 0.01, 0.76);
firstPersonMuzzle.material = sparkMaterial;
firstPersonMuzzle.setEnabled(false);

const avatars = new Map<string, Avatar>();
const playerNames = new Map<string, string>();
const particles: Particle[] = [];
const keys = new Set<string>();
const serverPosition = camera.position.clone();
let socket: WebSocket | null = null;
let playerId = "";
let yaw = 0;
let pitch = 0;
let health = 100;
let respawnAtMs: number | null = null;
let hasServerPosition = false;
let latestSnapshotAt = performance.now();
let firing = false;
let lastLocalShotAt = 0;
let muzzleUntil = 0;
let recoil = 0;
let lastFrameAt = performance.now();
let renderFrames = 0;
let receivedSnapshots = 0;
let receivedShots = 0;
let confirmedHits = 0;
let jumpQueued = false;

window.addEventListener("message", (event) => {
  if (
    event.origin !== parentOrigin
    || event.source !== window.parent
    || event.data?.type !== "battleprompt.initialize"
    || event.data.roomCode !== roomCode
    || typeof event.data.gameToken !== "string"
  ) return;
  connect(event.data.gameToken);
});
window.parent.postMessage({ type: "game.loaded" }, parentOrigin);

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) jumpQueued = true;
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => {
  keys.clear();
  jumpQueued = false;
  firing = false;
});
canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  canvas.focus();
  firing = true;
  tryShoot(performance.now());
});
canvas.addEventListener("click", () => {
  if (document.pointerLockElement === canvas) return;
  canvas.focus();
  void canvas.requestPointerLock().catch(() => undefined);
});
window.addEventListener("mouseup", () => { firing = false; });
document.addEventListener("pointerlockchange", () => {
  canvas.dataset.pointerLocked = String(document.pointerLockElement === canvas);
  firing = false;
});
document.addEventListener("mousemove", (event) => {
  const hasPointerLock = document.pointerLockElement === canvas;
  const hasFocusedCanvas = document.pointerLockElement === null
    && document.activeElement === canvas
    && event.target === canvas;
  if (!hasPointerLock && !hasFocusedCanvas) return;
  yaw += event.movementX * 0.002;
  pitch = Math.max(-1.35, Math.min(1.35, pitch + event.movementY * 0.002));
  camera.rotation.set(pitch, yaw, 0);
});

window.setInterval(() => {
  if (socket?.readyState !== WebSocket.OPEN || !hasServerPosition) return;
  socket.send(JSON.stringify({
    type: "input",
    forward: Number(keys.has("KeyW")) - Number(keys.has("KeyS")),
    strafe: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
    jump: jumpQueued,
    yaw,
    pitch,
  }));
  jumpQueued = false;
}, 1000 / INPUT_HZ);

function connect(token: string): void {
  if (roomCode === null || socket !== null) return;
  socket = new WebSocket(`${apiOrigin.replace(/^http/, "ws")}/ws/game/${roomCode}`);
  socket.addEventListener("open", () => socket?.send(JSON.stringify({ type: "authenticate", token })));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "authenticated") {
      playerId = message.playerId;
      health = message.config.startingHealth;
      status.textContent = "CLICK TO DEPLOY";
      window.parent.postMessage({ type: "game.ready" }, parentOrigin);
      return;
    }
    if (message.type === "shot") {
      handleShot(message as ShotMessage);
      return;
    }
    if (message.type !== "snapshot" || !Array.isArray(message.players)) return;
    receivedSnapshots += 1;
    canvas.dataset.snapshots = String(receivedSnapshots);
    latestSnapshotAt = performance.now();
    const seen = new Set<string>();
    for (const state of message.players as PlayerState[]) {
      playerNames.set(state.id, state.displayName);
      if (state.id === playerId) {
        serverPosition.set(state.x, state.y, state.z);
        health = state.health;
        const wasRespawning = respawnAtMs !== null;
        respawnAtMs = state.respawnAtMs;
        if (!hasServerPosition || (wasRespawning && respawnAtMs === null)) {
          camera.position.copyFrom(serverPosition);
          yaw = state.yaw;
          pitch = state.pitch;
          camera.rotation.set(pitch, yaw, 0);
          hasServerPosition = true;
        }
        status.textContent = respawnAtMs === null
          ? `${health} HP${message.phase === "WARMUP" ? " · UNSCORED" : ""}`
          : `RESPAWNING ${Math.max(1, Math.ceil((respawnAtMs - Date.now()) / 1000))}`;
        weaponRoot.setEnabled(respawnAtMs === null);
        continue;
      }

      seen.add(state.id);
      let avatar = avatars.get(state.id);
      if (avatar === undefined) {
        avatar = createAvatar(state.id);
        avatar.root.position.set(state.x, state.y - PLAYER_EYE_HEIGHT, state.z);
        avatars.set(state.id, avatar);
      }
      avatar.targetPosition.set(state.x, state.y - PLAYER_EYE_HEIGHT, state.z);
      avatar.targetYaw = state.yaw;
      avatar.root.setEnabled(state.respawnAtMs === null);
    }
    for (const [id, avatar] of avatars) {
      if (!seen.has(id)) {
        avatar.root.dispose(false, true);
        avatars.delete(id);
      }
    }
    canvas.dataset.avatars = String(avatars.size);
  });
  socket.addEventListener("close", () => {
    status.textContent = "CONNECTION LOST";
    firing = false;
  });
}

function createAvatar(id: string): Avatar {
  const root = new TransformNode(`avatar-${id}`, scene);
  const uniformMaterial = material(`uniform-${id}`, colorFromId(id));
  const skinMaterial = material(`skin-${id}`, new Color3(0.67, 0.48, 0.34));
  const body = MeshBuilder.CreateBox(`body-${id}`, { width: 0.72, height: 0.85, depth: 0.38 }, scene);
  body.parent = root;
  body.position.y = 1.18;
  body.material = uniformMaterial;
  const head = MeshBuilder.CreateSphere(`head-${id}`, { diameter: 0.48, segments: 8 }, scene);
  head.parent = root;
  head.position.y = 1.86;
  head.material = skinMaterial;
  const leftLeg = limb(`left-leg-${id}`, root, -0.2, 0.47, 0, 0.23, 0.86, uniformMaterial);
  const rightLeg = limb(`right-leg-${id}`, root, 0.2, 0.47, 0, 0.23, 0.86, uniformMaterial);
  const leftArm = limb(`left-arm-${id}`, root, -0.48, 1.25, 0.08, 0.18, 0.76, skinMaterial);
  const rightArm = limb(`right-arm-${id}`, root, 0.48, 1.25, 0.08, 0.18, 0.76, skinMaterial);
  const rifle = MeshBuilder.CreateBox(`rifle-${id}`, { width: 0.14, height: 0.14, depth: 0.9 }, scene);
  rifle.parent = root;
  rifle.position.set(0.27, 1.27, 0.5);
  rifle.material = gunMaterial;
  const muzzle = MeshBuilder.CreateSphere(`muzzle-${id}`, { diameter: 0.16, segments: 6 }, scene);
  muzzle.parent = root;
  muzzle.position.set(0.27, 1.27, 1);
  muzzle.material = sparkMaterial;
  muzzle.setEnabled(false);
  return {
    root,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    muzzle,
    targetPosition: root.position.clone(),
    targetYaw: 0,
    previousX: root.position.x,
    previousZ: root.position.z,
    walkPhase: 0,
    muzzleUntil: 0,
  };
}

function limb(
  name: string,
  parent: TransformNode,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  limbMaterial: StandardMaterial,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth: width }, scene);
  mesh.parent = parent;
  mesh.position.set(x, y, z);
  mesh.material = limbMaterial;
  return mesh;
}

function tryShoot(nowMs: number): void {
  if (socket?.readyState !== WebSocket.OPEN || respawnAtMs !== null || nowMs - lastLocalShotAt < 250) return;
  lastLocalShotAt = nowMs;
  muzzleUntil = nowMs + 65;
  recoil = 1;
  socket.send(JSON.stringify({ type: "shoot", yaw, pitch }));
}

function handleShot(message: ShotMessage): void {
  receivedShots += 1;
  canvas.dataset.shots = String(receivedShots);
  const origin = new Vector3(message.origin.x, message.origin.y, message.origin.z);
  const end = new Vector3(message.end.x, message.end.y, message.end.z);
  const tracer = MeshBuilder.CreateLines(`tracer-${performance.now()}`, { points: [origin, end] }, scene);
  tracer.color = message.victimId === null ? new Color3(1, 0.72, 0.22) : new Color3(1, 0.22, 0.08);
  setTimeout(() => tracer.dispose(), 90);

  if (message.attackerId === playerId) {
    muzzleUntil = performance.now() + 65;
    if (message.victimId !== null) {
      confirmedHits += 1;
      canvas.dataset.hits = String(confirmedHits);
      flashClass(hitMarker, "active", 100);
    }
  } else {
    const avatar = avatars.get(message.attackerId);
    if (avatar !== undefined) avatar.muzzleUntil = performance.now() + 65;
  }

  if (message.victimId !== null) {
    createImpact(end, true);
    if (message.victimId === playerId) flashClass(damageOverlay, "active", 150);
  } else {
    createImpact(end, false);
  }

  if (message.eliminated && message.victimId !== null) {
    const attackerName = playerNames.get(message.attackerId) ?? "Player";
    const victimName = playerNames.get(message.victimId) ?? "Player";
    addFeedEntry(`${attackerName} eliminated ${victimName}`);
  }
}

function createImpact(position: Vector3, isBlood: boolean): void {
  const count = isBlood ? 11 : 5;
  for (let index = 0; index < count; index += 1) {
    const particle = MeshBuilder.CreateSphere(`impact-${performance.now()}-${index}`, {
      diameter: isBlood ? 0.075 + Math.random() * 0.09 : 0.045,
      segments: 4,
    }, scene);
    particle.position.copyFrom(position);
    particle.material = isBlood ? bloodMaterial : sparkMaterial;
    particles.push({
      mesh: particle,
      velocity: new Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3.5,
        (Math.random() - 0.5) * 4,
      ),
      expiresAt: performance.now() + (isBlood ? 650 : 260),
    });
  }
}

function updateLocalPlayer(deltaSeconds: number, nowMs: number): void {
  if (!hasServerPosition || respawnAtMs !== null) return;
  const forwardInput = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  const strafeInput = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const inputLength = Math.hypot(forwardInput, strafeInput);
  if (inputLength > 0) {
    const normalizedForward = forwardInput / Math.max(1, inputLength);
    const normalizedStrafe = strafeInput / Math.max(1, inputLength);
    const distance = 6 * deltaSeconds;
    const nextX = camera.position.x
      + (Math.sin(yaw) * normalizedForward + Math.cos(yaw) * normalizedStrafe) * distance;
    const nextZ = camera.position.z
      + (Math.cos(yaw) * normalizedForward - Math.sin(yaw) * normalizedStrafe) * distance;
    if (!collidesWithArena(nextX, camera.position.z)) camera.position.x = nextX;
    if (!collidesWithArena(camera.position.x, nextZ)) camera.position.z = nextZ;
  }

  const snapshotAge = Math.min(0.1, (nowMs - latestSnapshotAt) / 1000);
  const predictedServer = serverPosition.clone();
  if (inputLength > 0) {
    predictedServer.x += (Math.sin(yaw) * forwardInput + Math.cos(yaw) * strafeInput) * 6 * snapshotAge / Math.max(1, inputLength);
    predictedServer.z += (Math.cos(yaw) * forwardInput - Math.sin(yaw) * strafeInput) * 6 * snapshotAge / Math.max(1, inputLength);
  }
  const error = Vector3.Distance(camera.position, predictedServer);
  if (error > 2.5) {
    camera.position.copyFrom(predictedServer);
  } else {
    Vector3.LerpToRef(camera.position, predictedServer, 1 - Math.exp(-8 * deltaSeconds), camera.position);
  }
  camera.position.y = serverPosition.y;
}

function updateAvatars(deltaSeconds: number, nowMs: number): void {
  const smoothing = 1 - Math.exp(-16 * deltaSeconds);
  for (const avatar of avatars.values()) {
    Vector3.LerpToRef(avatar.root.position, avatar.targetPosition, smoothing, avatar.root.position);
    avatar.root.rotation.y = lerpAngle(avatar.root.rotation.y, avatar.targetYaw, smoothing);
    const moved = Math.hypot(avatar.root.position.x - avatar.previousX, avatar.root.position.z - avatar.previousZ);
    avatar.previousX = avatar.root.position.x;
    avatar.previousZ = avatar.root.position.z;
    avatar.walkPhase += moved * 8;
    const stride = Math.min(0.65, moved / Math.max(deltaSeconds, 0.001) * 0.07) * Math.sin(avatar.walkPhase);
    avatar.leftLeg.rotation.x = stride;
    avatar.rightLeg.rotation.x = -stride;
    avatar.leftArm.rotation.x = -stride * 0.55;
    avatar.rightArm.rotation.x = stride * 0.55;
    avatar.muzzle.setEnabled(nowMs < avatar.muzzleUntil);
  }
}

function updateParticles(deltaSeconds: number, nowMs: number): void {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index]!;
    if (nowMs >= particle.expiresAt) {
      particle.mesh.dispose();
      particles.splice(index, 1);
      continue;
    }
    particle.velocity.y -= 8 * deltaSeconds;
    particle.mesh.position.addInPlace(particle.velocity.scale(deltaSeconds));
  }
}

function addFeedEntry(text: string): void {
  const entry = document.createElement("div");
  entry.textContent = text;
  killFeed.prepend(entry);
  window.setTimeout(() => entry.remove(), 4_000);
}

function flashClass(element: HTMLElement, className: string, durationMs: number): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), durationMs);
}

function material(name: string, color: Color3): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = color;
  value.specularColor = Color3.Black();
  return value;
}

function emissiveMaterial(name: string, color: Color3): StandardMaterial {
  const value = material(name, color);
  value.emissiveColor = color.scale(0.8);
  return value;
}

function colorFromId(id: string): Color3 {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const palette = [
    new Color3(0.08, 0.42, 0.62),
    new Color3(0.65, 0.2, 0.12),
    new Color3(0.22, 0.5, 0.25),
    new Color3(0.58, 0.42, 0.08),
  ];
  return palette[hash % palette.length] ?? palette[0]!;
}

function lerpAngle(current: number, target: number, amount: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * amount;
}

engine.runRenderLoop(() => {
  const nowMs = performance.now();
  const deltaSeconds = Math.min(0.05, (nowMs - lastFrameAt) / 1000);
  lastFrameAt = nowMs;
  if (firing) tryShoot(nowMs);
  updateLocalPlayer(deltaSeconds, nowMs);
  updateAvatars(deltaSeconds, nowMs);
  updateParticles(deltaSeconds, nowMs);
  recoil += (0 - recoil) * (1 - Math.exp(-18 * deltaSeconds));
  weaponRoot.position.y = -0.28 + recoil * 0.045;
  weaponRoot.position.z = 0.72 - recoil * 0.1;
  weaponRoot.rotation.x = recoil * 0.08;
  firstPersonMuzzle.setEnabled(nowMs < muzzleUntil);
  scene.render();
  renderFrames += 1;
  canvas.dataset.renderFrames = String(renderFrames);
  canvas.dataset.cameraX = camera.position.x.toFixed(3);
  canvas.dataset.cameraY = camera.position.y.toFixed(3);
  canvas.dataset.cameraZ = camera.position.z.toFixed(3);
  canvas.dataset.cameraYaw = yaw.toFixed(3);
  canvas.dataset.cameraPitch = pitch.toFixed(3);
});

window.addEventListener("resize", () => engine.resize());