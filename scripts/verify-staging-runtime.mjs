import assert from "node:assert/strict"
import { once } from "node:events"
import { spawn } from "node:child_process"
import { get } from "node:http"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { randomUUID } from "node:crypto"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STAGING_PROJECT_ID = "one-estela-place-staging"
const PRODUCTION_PROJECT_ID = "oneestela-ae9b5"
const launcherPath = path.join(ROOT, "scripts", "start-staging.mjs")
const port = Number(process.env.STAGING_RUNTIME_PORT || (4300 + (process.pid % 500)))
const baseUrl = `http://127.0.0.1:${port}`
const checkToken = randomUUID()

function requestText(url, headers = {}, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers }, (response) => {
      const chunks = []
      response.setEncoding("utf8")
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => resolve({ status: response.statusCode || 0, text: chunks.join("") }))
      response.on("error", reject)
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error("staging runtime request timed out")))
    request.on("error", reject)
  })
}

async function waitForReady(child) {
  let childError = null
  child.once("error", (error) => { childError = error })
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (childError) throw childError
    if (child.exitCode !== null) throw new Error(`Staging Next exited before readiness (${child.exitCode}).`)
    try {
      const response = await requestText(`${baseUrl}/verify-email`, {}, 5_000)
      if (response.status === 200) {
        if (child.exitCode !== null) throw new Error(`Staging Next exited before readiness (${child.exitCode}).`)
        return
      }
    } catch (error) {
      // The dev server is still compiling or listening on another phase.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("Staging Next server did not become ready.")
}

async function fetchPageScripts(pagePath) {
  const response = await requestText(`${baseUrl}${pagePath}`)
  assert.equal(response.status >= 200 && response.status < 300, true, `${pagePath} should load from the staging server`)
  const html = response.text
  const scriptSources = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1])
  const scriptResponses = await Promise.all(
    [...new Set(scriptSources)].map((source) => requestText(new URL(source, baseUrl), {}, 30_000)),
  )
  const bodies = [
    html,
    ...scriptResponses
      .filter((scriptResponse) => scriptResponse.status >= 200 && scriptResponse.status < 300)
      .map((scriptResponse) => scriptResponse.text),
  ]
  return bodies
}

function extractBrowserFirebaseProjectIds(bodies) {
  return [...new Set(
    bodies.flatMap((body) => [...body.matchAll(
      /firebaseConfig[\s\S]{0,2500}?projectId\s*:\s*(?:\([^,)]*,\s*)?["']([^"']+)["']/g,
    )].map((match) => match[1])),
  )]
}

async function stop(child, exitPromise) {
  if (child.exitCode !== null) return
  try {
    child.kill("SIGINT")
  } catch {
    child.kill()
  }
  await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ])
  if (child.exitCode === null && !child.killed) child.kill()
}

const environment = {
  ...process.env,
  STAGING_RUNTIME_CHECK_TOKEN: checkToken,
}
const child = spawn(process.execPath, [launcherPath, "--port", String(port)], {
  cwd: ROOT,
  env: environment,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
})
child.stdout.resume()
child.stderr.resume()
const exitPromise = once(child, "exit")

try {
  await waitForReady(child)
  const runtimeResponse = await requestText(
    `${baseUrl}/api/internal/staging-runtime`,
    { "x-staging-runtime-check": checkToken },
    120_000,
  )
  assert.equal(runtimeResponse.status, 200, "staging runtime diagnostic should be available only in the staging dev process")
  const runtime = JSON.parse(runtimeResponse.text)
  assert.equal(runtime.clientProjectId, STAGING_PROJECT_ID)
  assert.equal(runtime.adminProjectId, STAGING_PROJECT_ID)
  assert.equal(runtime.emailSendingEnabled, false)
  assert.equal(runtime.otpSendingEnabled, false)
  assert.equal(runtime.verificationEnforcementEnabled, false)

  const browserBodies = [
    ...(await fetchPageScripts("/")),
    ...(await fetchPageScripts("/verify-email")),
  ]
  const browserBundleHasProduction = browserBodies.some((body) => body.includes(PRODUCTION_PROJECT_ID))
  const browserFirebaseProjectIds = extractBrowserFirebaseProjectIds(browserBodies)
  assert.deepEqual(browserFirebaseProjectIds, [STAGING_PROJECT_ID], "browser Firebase config must resolve only to the staging project")
  assert.equal(browserBundleHasProduction, false, "browser bundle must not contain the production Firebase project ID")

  console.log(`STAGING_RUNTIME_SAFE client_project=${runtime.clientProjectId} admin_project=${runtime.adminProjectId} browser_project=${browserFirebaseProjectIds[0] || "UNVERIFIED"} browser_production_id=${browserBundleHasProduction} email_sending=${runtime.emailSendingEnabled} otp_sending=${runtime.otpSendingEnabled} verification_enforcement=${runtime.verificationEnforcementEnabled}`)
} finally {
  if (exitPromise) {
    await stop(child, exitPromise)
  } else if (child.exitCode === null) {
    try {
      child.kill("SIGINT")
    } catch {
      child.kill()
    }
  }
}
