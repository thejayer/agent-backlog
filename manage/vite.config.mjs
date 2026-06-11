import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { routeManageRequest } from "./server/manageRoutes.mjs";

const manageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(manageRoot, "..");

function manageAgentApi() {
  return {
    name: "manage-agent-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await routeManageRequest(req, res, "http://127.0.0.1:5186");

        if (!handled) {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  root: manageRoot,
  plugins: [react(), manageAgentApi()],
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4186,
  },
  build: {
    outDir: path.resolve(workspaceRoot, "dist", "manage"),
    emptyOutDir: true,
  },
});
