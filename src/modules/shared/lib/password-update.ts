import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword as updateFirebasePassword,
  type User as FirebaseUser,
} from "firebase/auth"

/** Re-authenticate the current password account before changing its password. */
export async function updateAuthenticatedPassword(
  user: FirebaseUser,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const email = String(user.email || "").trim()
  if (!email || !user.providerData.some((provider) => provider.providerId === "password")) {
    throw Object.assign(new Error("Password changes require an email/password sign-in."), {
      code: "auth/password-provider-required",
    })
  }
  if (!currentPassword || !newPassword) {
    throw Object.assign(new Error("Please fill in all password fields."), {
      code: "auth/password-fields-required",
    })
  }
  if (currentPassword === newPassword) {
    throw Object.assign(new Error("Your new password must be different from your current password."), {
      code: "auth/password-reuse",
    })
  }

  const credential = EmailAuthProvider.credential(email, currentPassword)
  await reauthenticateWithCredential(user, credential)
  await updateFirebasePassword(user, newPassword)
}
