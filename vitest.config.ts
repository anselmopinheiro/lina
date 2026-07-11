import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "tests/helpers/mockObsidian.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    globals: false,
    environment: "node",
  },
});