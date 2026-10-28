import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const boundary = vi.hoisted(() => ({
  profiles: new Map<string, Record<string, unknown>>(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  return {
    ApiAuthError,
    getSafeErrorCode: (error: unknown) => (
      error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "unknown"
    ),
    isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireBackofficeUser: async () => ({
      uid: "admin-1",
      role: "admin",
      fullName: "Fixture Administrator",
      permissions: {},
    }),
  }
})
vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    createUser: boundary.createUser,
    updateUser: boundary.updateUser,
    deleteUser: boundary.deleteUser,
  }),
  getAdminFirestore: () => ({
    collection: () => ({
      doc: (uid: string) => ({
        get: async () => {
          const data = boundary.profiles.get(uid)
          return { exists: Boolean(data), data: () => data && structuredClone(data) }
        },
        set: async (data: Record<string, unknown>) => { boundary.profiles.set(uid, structuredClone(data)) },
        update: async (data: Record<string, unknown>) => {
          boundary.profiles.set(uid, { ...(boundary.profiles.get(uid) || {}), ...structuredClone(data) })
        },
        delete: async () => { boundary.profiles.delete(uid) },
      }),
    }),
  }),
}))

import { PATCH as updateStaff, POST as createStaff } from "@/app/api/staff/route"

function request(body: Record<string, unknown>, method: "POST" | "PATCH" = "PATCH") {
  return new NextRequest("http://localhost/api/staff", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("server-only staff administration", () => {
  beforeEach(() => {
    boundary.profiles.clear()
    boundary.createUser.mockReset().mockResolvedValue({ uid: "staff-new" })
    boundary.updateUser.mockReset().mockResolvedValue(undefined)
    boundary.deleteUser.mockReset().mockResolvedValue(undefined)
    boundary.profiles.set("staff-1", {
      uid: "staff-1",
      role: "staff",
      status: "active",
      permissions: { dashboard: true },
    })
  })

  it("lets an authorized administrator update staff permissions through the API workflow", async () => {
    const response = await updateStaff(request({
      uid: "staff-1",
      permissions: { dashboard: true, payments: true },
    }))

    expect(response.status).toBe(200)
    expect(boundary.profiles.get("staff-1")).toMatchObject({
      role: "staff",
      permissions: { dashboard: true, payments: true },
    })
  })

  it("creates a staff account with server-assigned authorization fields", async () => {
    const response = await createStaff(request({
      email: "new-staff@example.test",
      password: "safe-fixture-password",
      firstName: "New",
      lastName: "Staff",
      position: "Coordinator",
      permissions: { users: true },
    }, "POST"))

    expect(response.status).toBe(201)
    expect(boundary.profiles.get("staff-new")).toMatchObject({
      uid: "staff-new",
      role: "staff",
      status: "active",
      permissions: { users: true },
    })
  })
})
