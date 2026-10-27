import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL(".", import.meta.url)),
    "@shared": fileURLToPath(new URL("./src/modules/shared", import.meta.url)),
  } },
})
