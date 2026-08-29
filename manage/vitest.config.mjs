import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["manage/**/*.test.mjs", "scripts/**/*.test.mjs"],
    exclude: ["manage/tests/**"],
    environment: "node",
  },
});
