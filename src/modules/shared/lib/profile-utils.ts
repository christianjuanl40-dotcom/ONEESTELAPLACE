const PROFILE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ProfileContactUpdate {
  email: string
  phone: string
}

export function normalizeProfileEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Please provide a valid email address.")

  const email = value.trim().toLowerCase()
  if (email.length === 0 || email.length > 254 || !PROFILE_EMAIL_PATTERN.test(email)) {
    throw new Error("Please provide a valid email address.")
  }
  return email
}

export function normalizeProfilePhone(value: unknown): string {
  if (typeof value !== "string") throw new Error("Please provide a valid phone number.")

  const phone = value.trim()
  if (phone.length > 40) throw new Error("Phone number is too long.")
  return phone
}

export function normalizeProfileContactUpdate<
  T extends { email?: unknown; phone?: unknown },
>(value: T): ProfileContactUpdate {
  return {
    email: normalizeProfileEmail(value.email),
    phone: normalizeProfilePhone(value.phone ?? ""),
  }
}
