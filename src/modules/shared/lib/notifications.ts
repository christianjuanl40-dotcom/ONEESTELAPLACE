"use client"

import { db } from "@/lib/firebase"
import { collection, addDoc, serverTimestamp } from "firebase/firestore"

export type NotificationType =
  | "booking_submitted"
  | "booking_approved"
  | "booking_rejected"
  | "modification_requested"
  | "modification_approved"
  | "modification_declined"
  | "cancellation_requested"
  | "cancellation_approved"
  | "cancellation_declined"
  | "payment_submitted"
  | "payment_approved"
  | "payment_rejected"
  | "payment_incomplete"
  | "remaining_balance_submitted"
  | "remaining_balance_approved"
  | "remaining_balance_rejected"
  | "maintenance_conflict"
  | "balance_reminder"

export interface NotificationItem {
  id?: string
  type: NotificationType
  title: string
  message: string
  bookingId: string
  userId: string
  relatedUserId?: string
  relatedUserName?: string
  isRead: boolean
  createdAt?: any
  link: string
}

const notificationsRef = collection(db, "notifications")

export async function createNotification(data: {
  type: NotificationType
  title: string
  message: string
  bookingId: string
  userId: string
  relatedUserId?: string
  relatedUserName?: string
  link: string
}) {
  console.log("[Notifications] createNotification payload:", data)
  try {
    const docRef = await addDoc(notificationsRef, {
      type: data.type,
      title: data.title,
      message: data.message,
      bookingId: data.bookingId,
      userId: data.userId,
      relatedUserId: data.relatedUserId ?? null,
      relatedUserName: data.relatedUserName ?? null,
      isRead: false,
      createdAt: serverTimestamp(),
      link: data.link,
    })
    console.log("[Notifications] Firestore write success, doc ID:", docRef.id)
  } catch (error) {
    console.error("[Notifications] Failed to create notification:", error)
  }
}
