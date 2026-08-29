import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertProductionAuthConfig } from "./server/auth.mjs";
import { routeManageRequest } from "./server/manageRoutes.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..");
const distRoot = path.resolve(workspaceRoot, "dist", "manage");
const port = Number(process.env.PORT || 4186);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const baseUrl = process.env.MANAGE_BASE_URL || `http://127.0.0.1:${port}`;

assertProductionAuthConfig();

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

function send(res, status, body, contentType) {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const absolutePath = path.resolve(distRoot, `.${requestedPath}`);

  if (!absolutePath.startsWith(distRoot)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  const fallbackPath = path.resolve(distRoot, "index.html");
  const filePath = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? absolutePath : fallbackPath;
  const ext = path.extname(filePath);
  const contentType = mimeTypes.get(ext) || "application/octet-stream";

  fs.createReadStream(filePath)
    .on("error", () => send(res, 500, "Failed to read asset", "text/plain; charset=utf-8"))
    .pipe(res.setHeader("Content-Type", contentType));
}

http
  .createServer(async (req, res) => {
    if (await routeManageRequest(req, res, baseUrl)) {
      return;
    }

    serveStatic(req, res);
  })
  .listen(port, host, () => {
    console.log(`Manage server listening at ${baseUrl}`);
  });
