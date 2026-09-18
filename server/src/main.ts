import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

import { WebSocketServer } from "ws";

import { GameRuntime } from "./game-runtime.js";
import { HttpGameControlPlane } from "./http-control-plane.js";

const port = Number.parseInt(requiredEnvironment("PORT"), 10);
const roomCode = requiredEnvironment("BATTLEPROMPT_ROOM_CODE").trim().toUpperCase();
const runtimeId = requiredEnvironment("BATTLEPROMPT_RUNTIME_ID");
const runtimeToken = requiredEnvironment("BATTLEPROMPT_RUNTIME_TOKEN");
const controlUrl = new URL(requiredEnvironment("BATTLEPROMPT_CONTROL_URL"));
const controlOrigin = requiredEnvironment("BATTLEPROMPT_CONTROL_ORIGIN");
const publicUrl = new URL(requiredEnvironment("BATTLEPROMPT_PUBLIC_URL"));
const publicWebSocketUrl = new URL(publicUrl);
publicWebSocketUrl.protocol = publicUrl.protocol === "https:" ? "wss:" : "ws:";
const clientRoot = resolve("client/dist");

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");
if ((publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") || publicUrl.username !== "" || publicUrl.password !== "") {
  throw new Error("BATTLEPROMPT_PUBLIC_URL is invalid");
}

const runtime = new GameRuntime(new HttpGameControlPlane(controlUrl, runtimeId, runtimeToken, roomCode));
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 4_096 });
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src ${publicUrl.origin}`,
    `connect-src ${publicUrl.origin} ${publicWebSocketUrl.origin}`,
    `img-src ${publicUrl.origin} data:`,
    `style-src ${publicUrl.origin}`,
    `worker-src ${publicUrl.origin} blob:`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${controlOrigin}`,
  ].join("; "));
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");

  const requestUrl = new URL(request.url ?? "/", "http://runtime.invalid");
  if (request.method === "GET" && requestUrl.pathname === "/health/ready") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end('{"status":"ready"}');
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }

  try {
    const filePath = await resolveClientFile(requestUrl.pathname);
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://runtime.invalid").pathname;
  if (pathname !== `/ws/game/${encodeURIComponent(roomCode)}`) {
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => runtime.accept(webSocket, roomCode));
});

const shutdown = () => {
  runtime.close();
  webSockets.close();
  server.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(port, "0.0.0.0", () => console.log(`Game runtime listening on port ${port}`));

async function resolveClientFile(pathname: string): Promise<string> {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = resolve(clientRoot, relativePath);
  if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${sep}`)) throw new Error("Path escaped client root");
  const file = await stat(filePath);
  if (!file.isFile()) throw new Error("Path is not a file");
  return filePath;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function contentType(filePath: string): string {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  } as Record<string, string>)[extname(filePath)] ?? "application/octet-stream";
}