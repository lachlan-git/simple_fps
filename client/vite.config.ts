import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    cors: true,
    headers: {
      "Content-Security-Policy": "frame-ancestors http://localhost:5173",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  },
});