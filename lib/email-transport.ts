import "server-only"

import nodemailer, { type Transporter } from "nodemailer"
import { getEmailConfig, type EmailConfig } from "@/lib/email-config"

let cached: { key: string; transporter: Transporter } | null = null

function transportKey(config: EmailConfig): string {
  // The password is intentionally not part of the key or any diagnostic.
  return [config.host, config.port, config.secure, config.user, config.from].join("\u0000")
}

export function createGmailTransport(config = getEmailConfig()): Transporter {
  if (!config.smtpConfigured) {
    throw new Error("Email SMTP configuration is incomplete.")
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.appPassword,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
}

export function getEmailTransport(config = getEmailConfig()): Transporter {
  const key = transportKey(config)
  if (cached?.key === key) return cached.transporter
  const transporter = createGmailTransport(config)
  cached = { key, transporter }
  return transporter
}

/** Test-only cache reset; it does not expose credentials or transport internals. */
export function resetEmailTransportForTests(): void {
  cached = null
}
