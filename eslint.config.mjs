import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "test-results/**",
    "server_error.txt",
    "server_output.txt",
    "tsconfig.tsbuildinfo",
  ]),
  {
    rules: {
      // The existing React 18 UI uses effects for external subscriptions and
      // legacy state synchronization; keep these as warnings during cleanup.
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
])
