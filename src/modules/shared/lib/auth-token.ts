import { auth } from "@/lib/firebase"

export async function getAuthHeaders(includeJsonContentType = false): Promise<Record<string, string>> {
  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new Error("Authentication is required.")
  }

  const token = await currentUser.getIdToken()
  return {
    Authorization: `Bearer ${token}`,
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
  }
}
