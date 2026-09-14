"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type React from "react"
import { db } from "@/lib/firebase"
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore"
import { uploadToCloudinary, validateFileType } from "@/src/modules/shared/lib/cloudinary"

export interface PaymentProof {
  id: string
  firestoreId?: string
  bookingId: string
  amount: number
  paymentAmount?: number
  paymentMethod: "bank" | "cash"
  referenceNumber?: string
  paymentReference?: string
  proofUrl?: string
  notes?: string
  adminNote?: string
  fileName?: string
  fileSize?: number
  paymentDate?: string
  uploadedAt?: string
  status: "pending" | "verified" | "rejected"
  submittedAt: string
  reviewedAt?: string
  reviewedBy?: string
  rejectionReason?: string
}

interface NewPaymentProofInput {
  bookingId: string
  amount: number
  paymentMethod: "bank" | "cash"
  referenceNumber?: string
  paymentReference?: string
  proofUrl?: string
  fileName?: string
  fileSize?: number
  notes?: string
  paymentDate?: string
  uploadedAt?: string
  file?: File | null
  paymentDetails?: Record<string, unknown>
}

interface PaymentProofContextValue {
  proofs: PaymentProof[]
  uploadPaymentProof: (input: NewPaymentProofInput | string, file?: File | null, paymentDetails?: Record<string, unknown>) => Promise<PaymentProof>
  getPaymentProofByBooking: (bookingId: string) => PaymentProof | undefined
  getPaymentProofsByBooking: (bookingId: string) => PaymentProof[]
  reviewPaymentProof: (id: string, status: "verified" | "rejected", reviewer: string, rejectionReason?: string) => void
  removePaymentProof: (id: string) => void
  clearAll: () => void
}

const PaymentProofContext = createContext<PaymentProofContextValue | undefined>(undefined)

const proofsRef = collection(db, "paymentProofs")
const proofsQuery = query(proofsRef, orderBy("submittedAt", "desc"))

export function PaymentProofProvider({ children }: { children: React.ReactNode }) {
  const [proofs, setProofs] = useState<PaymentProof[]>([])
  const initialLoadDone = useRef(false)

  useEffect(() => {
    const unsub = onSnapshot(proofsQuery, (snapshot) => {
      const loaded: PaymentProof[] = []
      snapshot.forEach((docSnap) => {
        const data = docSnap.data()
        loaded.push({
          id: docSnap.id,
          firestoreId: docSnap.id,
          bookingId: data.bookingId || "",
          amount: data.amount || 0,
          paymentAmount: data.paymentAmount || data.amount || 0,
          paymentMethod: data.paymentMethod || "bank",
          referenceNumber: data.referenceNumber || "",
          paymentReference: data.paymentReference || data.referenceNumber || "",
          proofUrl: data.proofUrl || "",
          notes: data.notes || "",
          adminNote: data.adminNote || "",
          fileName: data.fileName || "",
          fileSize: data.fileSize || 0,
          paymentDate: data.paymentDate || "",
          uploadedAt: data.uploadedAt || data.submittedAt || "",
          status: data.status || "pending",
          submittedAt: data.submittedAt?.toDate?.()?.toISOString() || data.submittedAt || new Date().toISOString(),
          reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || data.reviewedAt || "",
          reviewedBy: data.reviewedBy || "",
          rejectionReason: data.rejectionReason || "",
        })
      })
      setProofs(loaded)
      initialLoadDone.current = true
    }, (error) => {
      console.error("[PaymentProof] Firestore snapshot error:", error)
    })

    return () => unsub()
  }, [])

  const uploadPaymentProof = useCallback(
    async (input: NewPaymentProofInput | string, file?: File | null, paymentDetails?: Record<string, unknown>) => {
      const now = new Date().toISOString()
      const normalized: NewPaymentProofInput =
        typeof input === "string"
          ? {
              bookingId: input,
              amount: Number(paymentDetails?.amount ?? 0),
              paymentMethod: (paymentDetails?.paymentMethod as "bank" | "cash") ?? "bank",
              referenceNumber: paymentDetails?.referenceNumber as string | undefined,
              fileName: file?.name,
              fileSize: file?.size,
              paymentDate: (paymentDetails?.paymentDate as string) ?? now,
              notes: paymentDetails?.notes as string | undefined,
            }
          : input

      let imageUrl = normalized.proofUrl || ""

      if (file) {
        const resourceType = validateFileType(file, { allowDocuments: true });
        if (!resourceType) {
          throw new Error("Unsupported file type. Allowed: jpg, jpeg, png, webp, pdf, doc, docx.");
        }
        const result = await uploadToCloudinary(file, {
          folder: `payment-proofs/${normalized.bookingId}`,
          resourceType: resourceType as "image" | "raw",
        });
        imageUrl = result.secureUrl;
      }

      const docRef = await addDoc(proofsRef, {
        bookingId: normalized.bookingId,
        amount: normalized.amount,
        paymentAmount: normalized.amount,
        paymentMethod: normalized.paymentMethod,
        referenceNumber: normalized.referenceNumber?.trim() || "",
        paymentReference: normalized.paymentReference?.trim() || normalized.referenceNumber?.trim() || "",
        proofUrl: imageUrl,
        fileName: (normalized.fileName ?? file?.name) || "",
        fileSize: (normalized.fileSize ?? file?.size) || 0,
        notes: normalized.notes || "",
        paymentDate: normalized.paymentDate || now,
        uploadedAt: normalized.uploadedAt || now,
        submittedAt: serverTimestamp(),
        status: "pending",
      })

      const entry: PaymentProof = {
        id: docRef.id,
        firestoreId: docRef.id,
        bookingId: normalized.bookingId,
        amount: normalized.amount,
        paymentAmount: normalized.amount,
        paymentMethod: normalized.paymentMethod,
        referenceNumber: normalized.referenceNumber?.trim(),
        paymentReference: normalized.paymentReference?.trim() || normalized.referenceNumber?.trim(),
        proofUrl: imageUrl,
        fileName: normalized.fileName ?? file?.name,
        fileSize: normalized.fileSize ?? file?.size,
        notes: normalized.notes,
        paymentDate: normalized.paymentDate || now,
        uploadedAt: normalized.uploadedAt || now,
        submittedAt: now,
        status: "pending",
      }

      return entry
    },
    []
  )

  const getPaymentProofByBooking = useCallback(
    (bookingId: string) => proofs.find((proof) => proof.bookingId === bookingId),
    [proofs]
  )

  const getPaymentProofsByBooking = useCallback(
    (bookingId: string) => proofs.filter((proof) => proof.bookingId === bookingId),
    [proofs]
  )

  const reviewPaymentProof = useCallback(
    async (id: string, status: "verified" | "rejected", reviewer: string, rejectionReason?: string) => {
      await updateDoc(doc(db, "paymentProofs", id), {
        status,
        reviewedAt: serverTimestamp(),
        reviewedBy: reviewer,
        rejectionReason: status === "rejected" ? (rejectionReason || "") : "",
      })
    },
    []
  )

  const removePaymentProof = useCallback(async (id: string) => {
    await updateDoc(doc(db, "paymentProofs", id), { status: "rejected", reviewedAt: serverTimestamp() })
  }, [])

  const clearAll = useCallback(async () => {
    const snapshot = await getDocs(proofsQuery)
    const updates: Promise<void>[] = []
    snapshot.forEach((docSnap) => {
      updates.push(updateDoc(doc(db, "paymentProofs", docSnap.id), { status: "rejected" }))
    })
    await Promise.all(updates)
  }, [])

  const value: PaymentProofContextValue = {
    proofs,
    uploadPaymentProof,
    getPaymentProofByBooking,
    getPaymentProofsByBooking,
    reviewPaymentProof,
    removePaymentProof,
    clearAll,
  }

  return <PaymentProofContext.Provider value={value}>{children}</PaymentProofContext.Provider>
}

export function usePaymentProof(): PaymentProofContextValue {
  const ctx = useContext(PaymentProofContext)
  if (!ctx) {
    throw new Error("usePaymentProof must be used within a PaymentProofProvider")
  }
  return ctx
}
