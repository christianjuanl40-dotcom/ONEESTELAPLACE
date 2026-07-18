import { db } from "@/lib/firebase"
import { doc, getDoc, setDoc, onSnapshot, updateDoc, increment as fireIncrement } from "firebase/firestore"

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

export async function incrementUnread(scope: "client" | "admin", by = 1) {
  await updateDoc(docRef(scope), { count: fireIncrement(by) })
}

export async function clearUnread(scope: "client" | "admin") {
  await setDoc(docRef(scope), { count: 0 })
}

export function subscribeUnreadUpdates(callback: (count: number) => void) {
  const unsubClient = onSnapshot(docRef("client"), (snap) => {
    callback(snap.data()?.count ?? 0)
  }, (error) => {
    console.error("[ChatUnread] Client unread snapshot error:", error)
  })
  const unsubAdmin = onSnapshot(docRef("admin"), (snap) => {
    callback(snap.data()?.count ?? 0)
  }, (error) => {
    console.error("[ChatUnread] Admin unread snapshot error:", error)
  })
  return () => {
    unsubClient()
    unsubAdmin()
  }
}

export function subscribeScopeUnread(scope: "client" | "admin", callback: (count: number) => void) {
  const unsub = onSnapshot(docRef(scope), (snap) => {
    callback(snap.data()?.count ?? 0)
  }, (error) => {
    console.error(`[ChatUnread] ${scope} unread snapshot error:`, error)
  })
  return unsub
}
