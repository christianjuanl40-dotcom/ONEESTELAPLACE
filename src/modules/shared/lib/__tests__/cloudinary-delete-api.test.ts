import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const boundary = vi.hoisted(() => ({
  destroy: vi.fn(),
  user: null as null | { uid: string; role: "admin" | "staff" | "client"; permissions: Record<string, boolean> },
}))

vi.mock("server-only", () => ({}))
vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: { destroy: boundary.destroy },
  },
}))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  return {
    ApiAuthError,
    isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: async () => {
      if (!boundary.user) throw new ApiAuthError(401, "Authentication is required.")
      return boundary.user
    },
  }
})

import { POST as deleteAsset } from "@/app/api/cloudinary/delete/route"

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/cloudinary/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Cloudinary asset ownership", () => {
  beforeEach(() => {
    boundary.destroy.mockReset().mockResolvedValue({ result: "ok" })
    boundary.user = { uid: "client-1", role: "client", permissions: {} }
  })

  it("allows a client to delete an asset in its server-enforced profile namespace", async () => {
    const response = await deleteAsset(request({ publicId: "profiles/client-1/avatar" }))

    expect(response.status).toBe(200)
    expect(boundary.destroy).toHaveBeenCalledWith(
      "profiles/client-1/avatar",
      { resource_type: "image", type: "upload" },
    )
  })

  it("rejects another user's profile namespace", async () => {
    const response = await deleteAsset(request({ publicId: "profiles/client-2/avatar" }))

    expect(response.status).toBe(403)
    expect(boundary.destroy).not.toHaveBeenCalled()
  })

  it("does not treat a forged CMS URL or legacy profile ID as ownership proof", async () => {
    const forgedCms = await deleteAsset(request({ publicId: "cms/public-photo" }))
    const legacy = await deleteAsset(request({ publicId: "legacy/profile-photo" }))

    expect(forgedCms.status).toBe(403)
    expect(legacy.status).toBe(403)
    expect(boundary.destroy).not.toHaveBeenCalled()
  })

  it("preserves CMS deletion for authorized administrators and CMS staff", async () => {
    boundary.user = { uid: "admin-1", role: "admin", permissions: {} }
    expect((await deleteAsset(request({ publicId: "cms/gallery/photo" }))).status).toBe(200)

    boundary.user = { uid: "cms-staff", role: "staff", permissions: { cms: true } }
    expect((await deleteAsset(request({ publicId: "cms/gallery/second-photo" }))).status).toBe(200)
  })

  it("rejects unauthorized staff and invalid IDs/resource types", async () => {
    boundary.user = { uid: "staff-1", role: "staff", permissions: { cms: false } }
    expect((await deleteAsset(request({ publicId: "cms/gallery/photo" }))).status).toBe(403)

    for (const publicId of ["", "../cms/photo", "cms/", "profiles/client-1/../cms/photo", "profiles/client-1//photo"]) {
      expect((await deleteAsset(request({ publicId }))).status).toBe(400)
    }
    expect((await deleteAsset(request({ publicId: "profiles/client-1/document", resourceType: "raw" }))).status).toBe(403)
    expect((await deleteAsset(request({ publicId: "profiles/client-1/avatar", resourceType: "video" }))).status).toBe(400)
    expect(boundary.destroy).not.toHaveBeenCalled()
  })

  it("supports the explicitly requested raw resource type only within an authorized CMS namespace", async () => {
    boundary.user = { uid: "cms-staff", role: "staff", permissions: { cms: true } }

    const response = await deleteAsset(request({ publicId: "cms/contracts/preview", resourceType: "raw" }))

    expect(response.status).toBe(200)
    expect(boundary.destroy).toHaveBeenCalledWith(
      "cms/contracts/preview",
      { resource_type: "raw", type: "upload" },
    )
  })
})
