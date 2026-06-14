import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
  },
  resolve: {
    // Mirror the tsconfig "@/*" -> "./*" path alias so tests can import like the app.
    alias: { "@": root },
  },
});
