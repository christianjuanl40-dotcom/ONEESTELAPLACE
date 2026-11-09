/** Build-only disposable identity. Never load credential values or deploy. */
import { readFileSync, existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const env = { ...process.env }
for (const name of Object.keys(env)) {
  if (/FIREBASE|CLOUDINARY|SMTP|EMAIL_|CRON_SECRET|APP_BASE_URL|GOOGLE_|GCLOUD|ONEESTELA/.test(name)) env[name] = ""
}
// Empty sentinels prevent Next's dotenv loader from filling these names from
// .env.local. Only names are inspected; no configured values are propagated.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.example"]) {
  const file = resolve(root, name)
  if (!existsSync(file)) continue
  for (const match of readFileSync(file, "utf8").matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = ""
}
Object.assign(env, {
  NODE_ENV: "production", ONEESTELA_ENV: "local-validation", NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-one-estela-place",
  NEXT_PUBLIC_FIREBASE_API_KEY: "disposable-local-build-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-one-estela-place.invalid",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-one-estela-place.invalid",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123456789:web:disposable",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456789",
  FIREBASE_ADMIN_PROJECT_ID: "demo-one-estela-place",
  FIREBASE_ADMIN_CLIENT_EMAIL: "", FIREBASE_ADMIN_PRIVATE_KEY: "", GOOGLE_APPLICATION_CREDENTIALS: "",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  EMAIL_SENDING_ENABLED: "false", EMAIL_OTP_SENDING_ENABLED: "false", EMAIL_VERIFICATION_ENFORCEMENT_ENABLED: "false",
  APP_BASE_URL: "http://127.0.0.1:3000",
})
console.log("Safe build: disposable demo identity, no Admin credentials, email disabled, loopback-only emulators.")
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "build", ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" })
child.on("error", (error) => { console.error(error.message); process.exitCode = 1 })
child.on("exit", (code) => { process.exitCode = code ?? 1 })
