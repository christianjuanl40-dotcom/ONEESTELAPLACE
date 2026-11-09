import { spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STAGING_ENV_PATH = path.join(ROOT, ".env.staging.local")
const NEXT_ENV_FILE_NAMES = [".env.development.local", ".env.local", ".env.development", ".env"]
const PRODUCTION_PROJECT_ID = "oneestela-ae9b5"
const STAGING_PROJECT_ID = "one-estela-place-staging"
export const STAGING_DIST_DIR = ".next-staging"
const OTP_MIN_SECRET_LENGTH = 32
const CLIENT_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
]
const ADMIN_KEYS = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
]
const ISOLATED_KEYS = [
  ...CLIENT_KEYS,
  ...ADMIN_KEYS,
  "ONEESTELA_ENV",
  "EMAIL_SENDING_ENABLED",
  "EMAIL_OTP_SENDING_ENABLED",
  "EMAIL_OTP_STAGING_APPROVED",
  "EMAIL_OTP_PRODUCTION_APPROVED",
  "EMAIL_OTP_EXPIRY_SECONDS",
  "EMAIL_OTP_RESEND_COOLDOWN_SECONDS",
  "EMAIL_VERIFICATION_ENFORCEMENT_ENABLED",
  "EMAIL_VERIFICATION_ENFORCEMENT_START_AT",
  "NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED",
  "NEXT_PUBLIC_ONEESTELA_ENV",
  "NEXT_PUBLIC_PERF_TRACE",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL",
  "VERCEL_REGION",
  "VERCEL_TARGET_ENV",
  "EMAIL_OTP_SECRET",
  "EMAIL_TEST_RECIPIENT_ALLOWLIST",
  "EMAIL_TEST_RECIPIENT_ALLOWLIST_ONLY",
  "EMAIL_MAX_ATTEMPTS",
  "APP_BASE_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "EMAIL_FROM",
  "SMTP_APP_PASSWORD",
  "CRON_SECRET",
]

function value(environment, key) {
  return String(environment[key] || "").trim()
}

function normalizedAllowlist(environment) {
  return value(environment, "EMAIL_TEST_RECIPIENT_ALLOWLIST")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function isEmailAddress(valueToCheck) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueToCheck)
}

/** Return a sanitized startup-block code for owner-authorized staging OTP mode. */
export function getStagingOtpGuardFailure(environment = {}) {
  const otpSendingEnabled = value(environment, "EMAIL_OTP_SENDING_ENABLED").toLowerCase() === "true"
  const otpStagingApproved = value(environment, "EMAIL_OTP_STAGING_APPROVED").toLowerCase() === "true"
  if (!otpSendingEnabled && otpStagingApproved) return "otp_staging_approval_requires_sending_enabled"
  if (!otpSendingEnabled) return null
  if (!otpStagingApproved) return "otp_staging_approval_required"
  if (value(environment, "EMAIL_OTP_SECRET").length < OTP_MIN_SECRET_LENGTH) return "otp_secret_required"

  const allowlist = normalizedAllowlist(environment)
  if (allowlist.length !== 1 || !isEmailAddress(allowlist[0])) return "otp_exact_test_recipient_required"

  if (
    value(environment, "SMTP_HOST").toLowerCase() !== "smtp.gmail.com"
    || !value(environment, "SMTP_USER")
    || !value(environment, "SMTP_APP_PASSWORD")
    || !value(environment, "EMAIL_FROM")
  ) return "staging_otp_smtp_incomplete"

  return null
}

function blocked(code) {
  console.error(`STAGING_START_BLOCKED code=${code}`)
  process.exit(1)
}

export function buildNextSpawnSpec(root = ROOT, nextArguments = []) {
  const nextCliPath = path.join(root, "node_modules", "next", "dist", "bin", "next")
  return {
    command: process.execPath,
    args: [nextCliPath, ...nextArguments],
    cwd: root,
    shell: false,
  }
}

/**
 * Next loads dotenv files after the launcher starts. Empty sentinels are
 * intentional: @next/env treats an existing empty process value as defined,
 * so a value from .env.local cannot replace it. Staging values are applied
 * afterwards and therefore win for the explicitly approved staging keys.
 */
export function buildStagingChildEnvironment(
  parentEnvironment = process.env,
  stagingEnvironment = {},
  nextEnvFileKeys = [],
) {
  const isolatedKeys = new Set([...ISOLATED_KEYS, ...nextEnvFileKeys])
  const childEnvironment = { ...parentEnvironment }
  for (const key of isolatedKeys) delete childEnvironment[key]
  for (const [key, entry] of Object.entries(stagingEnvironment)) childEnvironment[key] = entry
  for (const key of isolatedKeys) {
    if (!(key in stagingEnvironment)) childEnvironment[key] = ""
  }
  childEnvironment.ONEESTELA_ENV = "staging"
  childEnvironment.NEXT_PUBLIC_ONEESTELA_ENV = "staging"
  childEnvironment.NODE_ENV = "development"
  return childEnvironment
}

/** Read names only; values are deliberately never returned or logged. */
export function getNextEnvironmentFileKeys(root = ROOT) {
  const keys = new Set()
  for (const fileName of NEXT_ENV_FILE_NAMES) {
    const filePath = path.join(root, fileName)
    if (!existsSync(filePath)) continue
    const parsed = parseEnv(readFileSync(filePath, "utf8"))
    for (const key of Object.keys(parsed)) keys.add(key)
  }
  return [...keys]
}

function clearStagingBuildCache() {
  try {
    rmSync(path.join(ROOT, STAGING_DIST_DIR), { recursive: true, force: true })
  } catch {
    blocked("staging_build_cache_cleanup_failed")
  }
}

function main() {
  if (!existsSync(STAGING_ENV_PATH)) blocked("staging_env_missing")

  let stagingEnvironment
  try {
    stagingEnvironment = parseEnv(readFileSync(STAGING_ENV_PATH, "utf8"))
  } catch {
    blocked("staging_env_parse_failed")
  }

  let nextEnvFileKeys
  try {
    nextEnvFileKeys = getNextEnvironmentFileKeys(ROOT)
  } catch {
    blocked("next_env_file_parse_failed")
  }

  const requiredClientKeys = CLIENT_KEYS.slice(0, 6)
  if (requiredClientKeys.some((key) => !value(stagingEnvironment, key))) blocked("staging_client_config_incomplete")
  if (value(stagingEnvironment, "ONEESTELA_ENV").toLowerCase() !== "staging") blocked("staging_runtime_identity_missing")
  if (value(stagingEnvironment, "EMAIL_SENDING_ENABLED").toLowerCase() !== "false") blocked("email_sending_must_be_disabled")
  if (value(stagingEnvironment, "EMAIL_VERIFICATION_ENFORCEMENT_ENABLED").toLowerCase() !== "false") blocked("verification_enforcement_must_be_disabled")
  if (value(stagingEnvironment, "EMAIL_OTP_PRODUCTION_APPROVED").toLowerCase() === "true") blocked("otp_production_approval_forbidden")

  const otpSendingEnabled = value(stagingEnvironment, "EMAIL_OTP_SENDING_ENABLED").toLowerCase() === "true"
  const otpGuardFailure = getStagingOtpGuardFailure(stagingEnvironment)
  if (otpGuardFailure) blocked(otpGuardFailure)

  const clientProjectId = value(stagingEnvironment, "NEXT_PUBLIC_FIREBASE_PROJECT_ID")
  const adminProjectId = value(stagingEnvironment, "FIREBASE_ADMIN_PROJECT_ID")
  const adminClientEmail = value(stagingEnvironment, "FIREBASE_ADMIN_CLIENT_EMAIL")
  const adminPrivateKey = value(stagingEnvironment, "FIREBASE_ADMIN_PRIVATE_KEY")

  if (clientProjectId === PRODUCTION_PROJECT_ID || adminProjectId === PRODUCTION_PROJECT_ID) {
    blocked("production_project_forbidden")
  }
  if (clientProjectId !== STAGING_PROJECT_ID || adminProjectId !== STAGING_PROJECT_ID) {
    blocked("staging_project_identity_mismatch")
  }
  if (value(stagingEnvironment, "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") !== `${STAGING_PROJECT_ID}.firebaseapp.com`) {
    blocked("staging_auth_domain_mismatch")
  }
  if (value(stagingEnvironment, "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET") !== `${STAGING_PROJECT_ID}.firebasestorage.app`) {
    blocked("staging_storage_bucket_mismatch")
  }
  if (!adminClientEmail || !adminPrivateKey) blocked("staging_admin_credentials_missing")
  if (!adminClientEmail.toLowerCase().endsWith(`@${STAGING_PROJECT_ID}.iam.gserviceaccount.com`)) {
    blocked("staging_admin_service_account_mismatch")
  }
  if (!adminPrivateKey.includes("BEGIN PRIVATE KEY")) blocked("staging_admin_private_key_invalid")

  const parentProjectId = value(process.env, "NEXT_PUBLIC_FIREBASE_PROJECT_ID")
  const parentAdminProjectId = value(process.env, "FIREBASE_ADMIN_PROJECT_ID")
  const parentAdminEmail = value(process.env, "FIREBASE_ADMIN_CLIENT_EMAIL").toLowerCase()
  if (
    parentProjectId === PRODUCTION_PROJECT_ID
    || parentAdminProjectId === PRODUCTION_PROJECT_ID
    || parentAdminEmail.includes(`@${PRODUCTION_PROJECT_ID}.iam.gserviceaccount.com`)
  ) {
    blocked("production_environment_present")
  }

  const checkOnly = process.argv.includes("--check")
  const nextArguments = process.argv.slice(2).filter((argument) => argument !== "--check")
  if (checkOnly) {
    const otpStagingApproved = value(stagingEnvironment, "EMAIL_OTP_STAGING_APPROVED").toLowerCase() === "true"
    console.log(`STAGING_ENV_VALID project_id=${STAGING_PROJECT_ID} email_sending=false otp_sending=${otpSendingEnabled} otp_staging_approved=${otpStagingApproved} verification_enforcement=false`)
    process.exit(0)
  }

  clearStagingBuildCache()
  const childEnvironment = buildStagingChildEnvironment(process.env, stagingEnvironment, nextEnvFileKeys)

  const launch = buildNextSpawnSpec(ROOT, ["dev", ...nextArguments])
  if (!existsSync(launch.args[0])) blocked("next_cli_missing")
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: childEnvironment,
    shell: launch.shell,
    stdio: "inherit",
  })

  const forwardSignal = (signal) => {
    if (child.exitCode !== null || child.killed) return
    try {
      child.kill(signal)
    } catch {
      child.kill()
    }
  }
  const cleanupSignals = () => {
    process.removeListener("SIGINT", onSigint)
    process.removeListener("SIGTERM", onSigterm)
  }
  const onSigint = () => forwardSignal("SIGINT")
  const onSigterm = () => forwardSignal("SIGTERM")
  process.once("SIGINT", onSigint)
  process.once("SIGTERM", onSigterm)

  child.on("error", () => {
    cleanupSignals()
    blocked("next_start_failed")
  })
  child.on("exit", (code, signal) => {
    cleanupSignals()
    if (signal) {
      console.error("STAGING_START_BLOCKED code=next_terminated")
      process.exitCode = 1
      return
    }
    process.exitCode = code ?? 1
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
