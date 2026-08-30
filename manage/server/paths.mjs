import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(currentDir, "..", "data");

export function getManageDataDir() {
  return path.resolve(process.env.MANAGE_DATA_DIR || defaultDataDir);
}

export function getWorkItemsPath() {
  return path.join(getManageDataDir(), "work-items.json");
}

export function getInitiativesPath() {
  return path.join(getManageDataDir(), "initiatives.json");
}

export function getGithubCachePath() {
  return path.join(getManageDataDir(), "github-cache.json");
}

export function getSavedViewsPath() {
  return path.join(getManageDataDir(), "saved-views.json");
}
