import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.{js,mjs}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "app/api/**"],
      reporter: ["text", "text-summary"],
    },
    testTimeout: 30000,
  },
});
