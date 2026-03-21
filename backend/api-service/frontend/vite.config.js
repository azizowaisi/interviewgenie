import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  // Relative base so /app works both at http://localhost:8001/app and https://host/api/svc/app
  base: "./",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../static/dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/static": "http://127.0.0.1:8001",
      "/users": "http://127.0.0.1:8001",
      "/cvs": "http://127.0.0.1:8001",
      "/history": "http://127.0.0.1:8001",
      "/sessions": "http://127.0.0.1:8001",
      "/topics": "http://127.0.0.1:8001",
      "/attempts": "http://127.0.0.1:8001",
      "/ats": "http://127.0.0.1:8001",
      "/health": "http://127.0.0.1:8001",
      "/docs": "http://127.0.0.1:8001",
      "/openapi.json": "http://127.0.0.1:8001",
    },
  },
});
