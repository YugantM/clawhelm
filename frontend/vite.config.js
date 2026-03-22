import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
  const basePath = env.VITE_BASE_PATH || "/";

  return {
    base: basePath,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/logs": proxyTarget,
        "/stats": proxyTarget,
        "/health": proxyTarget,
        "/refresh-models": proxyTarget,
        "/v1": proxyTarget,
      },
    },
  };
});
