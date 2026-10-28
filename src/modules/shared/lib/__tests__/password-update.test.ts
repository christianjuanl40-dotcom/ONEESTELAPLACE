import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  credential: vi.fn(),
  reauthenticate: vi.fn(),
  updatePassword: vi.fn(),
}))

vi.mock("firebase/auth", () => ({
  EmailAuthProvider: { credential: boundary.credential },
  reauthenticateWithCredential: boundary.reauthenticate,
  updatePassword: boundary.updatePassword,
}))

import { updateAuthenticatedPassword } from "../password-update"

const user = {
  email: "client@example.test",
  providerData: [{ providerId: "password" }],
} as any

describe("authenticated password updates", () => {
  beforeEach(() => {
    boundary.credential.mockReset().mockReturnValue("credential")
    boundary.reauthenticate.mockReset().mockResolvedValue(undefined)
    boundary.updatePassword.mockReset().mockResolvedValue(undefined)
  })

  it("reauthenticates with the current password before updating", async () => {
    await updateAuthenticatedPassword(user, "old-password", "new-password")

    expect(boundary.credential).toHaveBeenCalledWith("client@example.test", "old-password")
    expect(boundary.reauthenticate).toHaveBeenCalledWith(user, "credential")
    expect(boundary.updatePassword).toHaveBeenCalledWith(user, "new-password")
    expect(boundary.reauthenticate.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.updatePassword.mock.invocationCallOrder[0])
  })

  it("does not change the password when reauthentication fails", async () => {
    boundary.reauthenticate.mockRejectedValue(Object.assign(new Error("Wrong password"), { code: "auth/wrong-password" }))

    await expect(updateAuthenticatedPassword(user, "wrong", "new-password")).rejects.toMatchObject({
      code: "auth/wrong-password",
    })
    expect(boundary.updatePassword).not.toHaveBeenCalled()
  })

  it("rejects accounts without an email/password provider", async () => {
    await expect(updateAuthenticatedPassword({ ...user, providerData: [] } as any, "old", "new-password"))
      .rejects.toMatchObject({ code: "auth/password-provider-required" })
    expect(boundary.reauthenticate).not.toHaveBeenCalled()
    expect(boundary.updatePassword).not.toHaveBeenCalled()
  })
})
