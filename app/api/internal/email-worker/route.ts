import "server-only"

import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getEmailConfig } from "@/lib/email-config"
import { processEmailOutbox } from "@/lib/email-worker"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function matchesSecret(request: NextRequest): boolean {
  const expected = String(process.env.CRON_SECRET || "")
  if (!expected) return false
  const header = request.headers.get("authorization") || request.headers.get("x-cron-secret") || ""
  const supplied = header.replace(/^Bearer\s+/i, "").trim()
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function run(request: NextRequest) {
  if (!matchesSecret(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  const config = getEmailConfig()
  if (!config.enabled) return NextResponse.json({ status: "disabled" }, { headers: { "Cache-Control": "no-store" } })
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 10)
  try {
    const result = await processEmailOutbox(requestedLimit)
    return NextResponse.json(result, {
      status: result.status === "not_ready" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    console.error("[email worker] processing failed")
    return NextResponse.json({ error: "Email worker processing failed." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
