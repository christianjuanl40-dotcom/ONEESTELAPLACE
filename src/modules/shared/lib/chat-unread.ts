import { db } from "@/lib/firebase"
import { doc, getDoc, setDoc, onSnapshot, increment as fireIncrement } from "firebase/firestore"

function docRef(scope: "client" | "admin") {
  return doc(db, "unreadCounts", scope)
}

export async function getUnreadCount(scope: "client" | "admin"): Promise<number> {
  const snap = await getDoc(docRef(scope))
  return snap.data()?.count ?? 0
}

export async function setUnreadCount(scope: "client" | "admin", value: number) {
  const next = Math.max(0, Math.floor(value))
  await setDoc(docRef(scope), { count: next }, { merge: true })
}

// setDoc + merge (NOT updateDoc): the unreadCounts/{scope} document may not
// exist yet (e.g. first notification for a fresh client). updateDoc fails with
// "No document to update" in that case, while merge creates the document with
// the incremented count and never overwrites unrelated fields when it exists.
export async function incrementUnread(scope: "client" | "admin", by = 1) {
  await setDoc(docRef(scope), { count: fireIncrement(by) }, { merge: true })
}

export async function clearUnread(scope: "client" | "admin") {
  await setDoc(docRef(scope), { count: 0 }, { merge: true })
}

export function subscribeUnreadUpdates(callback: (count: number) => void) {
  console.log("[Firestore Listener START] UnreadCounts(client+admin)")
  const unsubClient = onSnapshot(docRef("client"), (snap) => {
    callback(snap.data()?.count ?? 0)
  }, (error) => {
    console.error("[ChatUnread] Client unread snapshot error:", { code: error.code, message: error.message, error })
  })
  const unsubAdmin = onSnapshot(docRef("admin"), (snap) => {
    callback(snap.data()?.count ?? 0)
  }, (error) => {
    console.error("[ChatUnread] Admin unread snapshot error:", { code: error.code, message: error.message, error })
  })
  return () => {
    console.log("[Firestore Listener STOP] UnreadCounts(client+admin)")
    unsubClient()
    unsubAdmin()
  }
}

export function subscribeScopeUnread(scope: "client" | "admin", callback: (count: number) => void) {
  console.log("[Firestore Listener START] UnreadCounts(" + scope + ")")
  const unsub = onSnapshot(docRef(scope), (snap) => {
    callback(snap.data()?.count ?? 0)
  }, (error) => {
    console.error(`[ChatUnread] ${scope} unread snapshot error:`, { code: error.code, message: error.message, error })
  })
  return () => {
    console.log("[Firestore Listener STOP] UnreadCounts(" + scope + ")")
    unsub()
  }
}
