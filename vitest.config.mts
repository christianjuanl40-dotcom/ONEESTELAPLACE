import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The staging launcher uses Node's built-in test runner because it tests
    // the real child-process/Windows spawn boundary. Keep it out of Vitest's
    // TypeScript fixture suite; run it with `node --test` instead.
    exclude: ["**/node_modules/**", "**/.git/**", "scripts/**/*.test.mjs"],
  },
  resolve: { alias: {
    "@": fileURLToPath(new URL(".", import.meta.url)),
    "@shared": fileURLToPath(new URL("./src/modules/shared", import.meta.url)),
  } },
})
