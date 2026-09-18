import { auth } from "@/lib/firebase"

export async function getAuthHeaders(
  includeJsonContentType = false,
  forceRefresh = false,
): Promise<Record<string, string>> {
  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new Error("Authentication is required.")
  }

  const token = await currentUser.getIdToken(forceRefresh)
  return {
    Authorization: `Bearer ${token}`,
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
  }
}
