import { NextRequest, NextResponse } from "next/server"
import "server-only"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import type { Auth } from "firebase-admin/auth"

let authInstance: Auth | null = null

async function getAdminAuth(): Promise<Auth> {
  if (authInstance) return authInstance

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials. Required env vars: " +
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.",
    )
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    })
  }

  const { getAuth } = await import("firebase-admin/auth")
  authInstance = getAuth()
  return authInstance
}

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const uid = searchParams.get("uid")

    if (!uid) {
      return NextResponse.json({ error: "Missing uid parameter" }, { status: 400 })
    }

    console.log("[DELETE /api/staff] Deleting staff:", uid)

    let auth: Auth
    try {
      auth = await getAdminAuth()
    } catch (initError) {
      return NextResponse.json(
        { error: "Failed to initialize Firebase Admin SDK" },
        { status: 500 },
      )
    }

    const firestore = getFirestore()

    // Delete Firestore document
    try {
      await firestore.collection("users").doc(uid).delete()
      console.log("[DELETE /api/staff] Firestore document deleted")
    } catch (firestoreError) {
      console.error("[DELETE /api/staff] Firestore delete error:", firestoreError)
      return NextResponse.json(
        {
          error:
            firestoreError instanceof Error
              ? firestoreError.message
              : "Failed to delete Firestore document",
        },
        { status: 500 },
      )
    }

    // Delete Firebase Auth user
    try {
      await auth.deleteUser(uid)
      console.log("[DELETE /api/staff] Auth user deleted")
    } catch (authError) {
      console.error("[DELETE /api/staff] Auth delete error:", authError)
      return NextResponse.json(
        {
          error:
            authError instanceof Error
              ? authError.message
              : "Failed to delete Auth user",
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[DELETE /api/staff] UNCAUGHT error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete staff",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("[POST /api/staff] STEP 1: parsing request body")
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch (parseError) {
      console.error("[POST /api/staff] STEP 1 FAILED: body parse error", parseError)
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      )
    }

    const { email, password, firstName, lastName, fullName, phone, position, permissions } = body as {
      email?: string
      password?: string
      firstName?: string
      lastName?: string
      fullName?: string
      phone?: string
      position?: string
      permissions?: Record<string, boolean>
    }

    if (!email || !password || !fullName) {
      console.log("[POST /api/staff] STEP 1b: missing fields")
      return NextResponse.json(
        { error: "Missing required fields: email, password, fullName" },
        { status: 400 },
      )
    }

    console.log("[POST /api/staff] STEP 2: getting Firebase Admin Auth instance")
    let auth: Auth
    try {
      auth = await getAdminAuth()
    } catch (initError) {
      console.error("[POST /api/staff] STEP 2 FAILED: getAdminAuth() threw", initError)
      return NextResponse.json(
        {
          error:
            initError instanceof Error
              ? initError.message
              : "Failed to initialize Firebase Admin SDK",
          step: "getAdminAuth",
        },
        { status: 500 },
      )
    }

    console.log("[POST /api/staff] STEP 3: creating Firebase user")
    let userRecord
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: fullName,
      })
    } catch (createError) {
      console.error("[POST /api/staff] STEP 3 FAILED: createUser threw", createError)
      const errorCode =
        createError instanceof Error && "code" in createError
          ? (createError as any).code
          : undefined
      return NextResponse.json(
        {
          error:
            createError instanceof Error
              ? createError.message
              : "Failed to create user",
          step: "createUser",
          code: errorCode,
        },
        { status: 409 },
      )
    }

    console.log(
      "[POST /api/staff] STEP 3 OK: user created with uid",
      userRecord.uid,
    )

    console.log("[POST /api/staff] STEP 4: creating Firestore profile")
    try {
      const firestore = getFirestore()
      const now = new Date().toISOString()
      const profileData: Record<string, unknown> = {
        uid: userRecord.uid,
        email,
        fullName,
        firstName: firstName || "",
        lastName: lastName || "",
        phone: phone || "",
        position: position || "",
        role: "staff",
        status: "active",
        permissions: permissions || {},
        createdAt: now,
        profilePicture: "",
      }
      await firestore.collection("users").doc(userRecord.uid).set(profileData)
      console.log("[POST /api/staff] STEP 4 OK: Firestore profile created")
    } catch (firestoreError) {
      console.error("[POST /api/staff] STEP 4 FAILED: Firestore write error", firestoreError)
      return NextResponse.json(
        {
          uid: userRecord.uid,
          warning: "User created in Auth but profile document failed to write to Firestore",
          error: firestoreError instanceof Error ? firestoreError.message : String(firestoreError),
        },
        { status: 201 },
      )
    }

    return NextResponse.json({ uid: userRecord.uid })
  } catch (error) {
    console.error("[POST /api/staff] UNCAUGHT error:", error)
    const message =
      error instanceof Error ? error.message : "Failed to create staff"
    return NextResponse.json(
      {
        error: message,
        stack:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.stack
              : null
            : undefined,
      },
      { status: 500 },
    )
  }
}
