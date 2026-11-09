import assert from "node:assert/strict"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { test } from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import {
  buildNextSpawnSpec,
  buildStagingChildEnvironment,
  getStagingOtpGuardFailure,
  getNextEnvironmentFileKeys,
  STAGING_DIST_DIR,
} from "./start-staging.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("shadows dotenv production values while preserving only staging identities", () => {
  const childEnvironment = buildStagingChildEnvironment(
    {
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "oneestela-ae9b5",
      FIREBASE_ADMIN_PROJECT_ID: "oneestela-ae9b5",
      FIREBASE_ADMIN_CLIENT_EMAIL: "firebase-adminsdk@oneestela-ae9b5.iam.gserviceaccount.com",
      CLOUDINARY_API_SECRET: "production-placeholder",
      VERCEL_ENV: "production",
      SMTP_USER: "production-placeholder",
      PATH: process.env.PATH,
    },
    {
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "one-estela-place-staging",
      FIREBASE_ADMIN_PROJECT_ID: "one-estela-place-staging",
      FIREBASE_ADMIN_CLIENT_EMAIL: "firebase-adminsdk@one-estela-place-staging.iam.gserviceaccount.com",
      ONEESTELA_ENV: "staging",
      EMAIL_SENDING_ENABLED: "false",
      EMAIL_OTP_SENDING_ENABLED: "false",
      EMAIL_OTP_STAGING_APPROVED: "false",
      EMAIL_VERIFICATION_ENFORCEMENT_ENABLED: "false",
    },
    [
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "FIREBASE_ADMIN_PROJECT_ID",
      "FIREBASE_ADMIN_CLIENT_EMAIL",
    ],
  )

  assert.equal(childEnvironment.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "one-estela-place-staging")
  assert.equal(childEnvironment.FIREBASE_ADMIN_PROJECT_ID, "one-estela-place-staging")
  assert.equal(childEnvironment.FIREBASE_ADMIN_CLIENT_EMAIL.endsWith("@one-estela-place-staging.iam.gserviceaccount.com"), true)
  assert.equal(childEnvironment.CLOUDINARY_API_SECRET, "")
  assert.equal(childEnvironment.VERCEL_ENV, "")
  assert.equal(childEnvironment.SMTP_USER, "")
  assert.equal(childEnvironment.ONEESTELA_ENV, "staging")
  assert.equal(childEnvironment.NEXT_PUBLIC_ONEESTELA_ENV, "staging")
  assert.equal(childEnvironment.EMAIL_SENDING_ENABLED, "false")
  assert.equal(childEnvironment.EMAIL_OTP_SENDING_ENABLED, "false")
  assert.equal(childEnvironment.EMAIL_OTP_STAGING_APPROVED, "false")
  assert.equal(childEnvironment.EMAIL_VERIFICATION_ENFORCEMENT_ENABLED, "false")
  assert.equal(STAGING_DIST_DIR, ".next-staging")
})

test("requires explicit staging OTP approval, one recipient, and staging SMTP", () => {
  const baseEnvironment = {
    EMAIL_OTP_SENDING_ENABLED: "true",
    EMAIL_OTP_STAGING_APPROVED: "true",
    EMAIL_OTP_SECRET: "x".repeat(32),
    EMAIL_TEST_RECIPIENT_ALLOWLIST: "client@example.test",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "staging-mailer@example.test",
    SMTP_APP_PASSWORD: "staging-app-password",
    EMAIL_FROM: "One Estela Place <staging-mailer@example.test>",
  }

  assert.equal(getStagingOtpGuardFailure(baseEnvironment), null)
  assert.equal(getStagingOtpGuardFailure({ ...baseEnvironment, EMAIL_OTP_STAGING_APPROVED: "false" }), "otp_staging_approval_required")
  assert.equal(getStagingOtpGuardFailure({ ...baseEnvironment, EMAIL_TEST_RECIPIENT_ALLOWLIST: "first@example.test,second@example.test" }), "otp_exact_test_recipient_required")
  assert.equal(getStagingOtpGuardFailure({ ...baseEnvironment, SMTP_USER: "" }), "staging_otp_smtp_incomplete")
  assert.equal(getStagingOtpGuardFailure({ EMAIL_OTP_STAGING_APPROVED: "true" }), "otp_staging_approval_requires_sending_enabled")
})

test("discovers dotenv key names without exposing their values", () => {
  const keys = getNextEnvironmentFileKeys(root)
  assert.equal(keys.includes("NEXT_PUBLIC_FIREBASE_PROJECT_ID"), true)
  assert.equal(keys.includes("FIREBASE_ADMIN_CLIENT_EMAIL"), true)
  assert.equal(keys.includes("FIREBASE_ADMIN_PRIVATE_KEY"), true)
})

test("Next dotenv loading cannot replace empty staging sentinels", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "one-estela-next-env-"))
  try {
    await writeFile(
      path.join(fixtureRoot, ".env.local"),
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID=oneestela-ae9b5\nCLOUDINARY_API_SECRET=production-placeholder\n",
      "utf8",
    )
    const child = spawn(process.execPath, [
      "-e",
      "const {loadEnvConfig}=require('@next/env'); loadEnvConfig(process.argv[1], true, {info(){}, error(){}}); process.stdout.write(JSON.stringify({firebase:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null, cloudinary:process.env.CLOUDINARY_API_SECRET ?? null}));",
      fixtureRoot,
    ], {
      env: {
        ...process.env,
        NODE_ENV: "development",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "",
        CLOUDINARY_API_SECRET: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk.toString() })
    child.stderr.resume()
    const [code, signal] = await once(child, "exit")
    assert.equal(signal, null)
    assert.equal(code, 0)
    assert.deepEqual(JSON.parse(output), { firebase: "", cloudinary: "" })
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test("launches the installed Next CLI through Node without a Windows command shim", async () => {
  const spec = buildNextSpawnSpec(root, ["--version"])
  const nextCliPath = path.join(root, "node_modules", "next", "dist", "bin", "next")

  assert.equal(spec.command, process.execPath)
  assert.equal(spec.shell, false)
  assert.equal(spec.cwd, root)
  assert.equal(spec.args[0], nextCliPath)
  assert.equal(existsSync(nextCliPath), true)
  assert.equal(spec.command.endsWith("npm.cmd"), false)
  assert.equal(spec.command.endsWith("npx.cmd"), false)

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    shell: spec.shell,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const [code, signal] = await once(child, "exit")
  assert.equal(signal, null)
  assert.equal(code, 0)
})

test("starts the staging launcher through the real child-process path", { skip: process.env.RUN_STAGING_STARTUP_TEST !== "1" }, async () => {
  const environment = { ...process.env }
  for (const key of [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
    "FIREBASE_ADMIN_PROJECT_ID",
    "FIREBASE_ADMIN_CLIENT_EMAIL",
    "FIREBASE_ADMIN_PRIVATE_KEY",
    "ONEESTELA_ENV",
  ]) delete environment[key]

  const launcherPath = path.join(root, "scripts", "start-staging.mjs")
  const port = String(4100 + (process.pid % 400))
  const child = spawn(process.execPath, [launcherPath, "--port", port], {
    cwd: root,
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exitPromise = once(child, "exit")
  let output = ""
  let ready = false
  let readyResolve
  let readyReject
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const timer = setTimeout(() => readyReject(new Error("Staging Next server did not become ready.")), 30_000)
  const capture = (chunk) => {
    output += chunk.toString()
    if (!ready && /(?:Local:|Ready in)/i.test(output)) {
      ready = true
      clearTimeout(timer)
      readyResolve()
    }
  }
  child.stdout.on("data", capture)
  child.stderr.on("data", capture)
  child.once("error", (error) => {
    clearTimeout(timer)
    readyReject(error)
  })

  try {
    await readyPromise
    assert.doesNotMatch(output, /spawn\s+EINVAL/i)
    try {
      child.kill("SIGINT")
    } catch {
      child.kill()
    }
    await Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Staging Next server did not stop after SIGINT.")), 10_000)),
    ])
    assert.doesNotMatch(output, /spawn\s+EINVAL/i)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && !child.killed) child.kill()
  }
})
