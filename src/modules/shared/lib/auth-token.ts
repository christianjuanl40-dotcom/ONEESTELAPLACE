import { auth } from "@/lib/firebase"
import { safeRead } from "./safe-read"

export async function getAuthScope(signal?: AbortSignal): Promise<string> {
  await safeRead(() => auth.authStateReady(), { signal, attempts: 1 })
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error("Authentication is required.")
  return uid
}

export async function getAuthHeaders(
  includeJsonContentType = false,
  forceRefresh = false,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const uid = await getAuthScope(signal)
  const currentUser = auth.currentUser
  if (!currentUser || currentUser.uid !== uid) {
    throw new Error("Authentication is required.")
  }

  const token = await safeRead(() => currentUser.getIdToken(forceRefresh), { signal, attempts: 1 })
  if (auth.currentUser?.uid !== uid) throw new Error("The signed-in account changed. Please retry.")
  return {
    Authorization: `Bearer ${token}`,
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
  }
}
