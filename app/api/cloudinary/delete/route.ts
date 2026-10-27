import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { isApiAuthError, requireAuthenticatedUser } from "@/lib/server-auth";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 16 * 1024;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function isSafePublicId(publicId: string): boolean {
  return publicId.length <= 200 && /^[a-z0-9._/-]+$/i.test(publicId) && !publicId.includes("..");
}

function publicIdFromCloudinaryUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "cloudinary.com" && !parsed.hostname.endsWith(".cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex < 0) return null;
    const pathParts = parts.slice(uploadIndex + 1).filter((part) => !/^v\d+$/.test(part));
    const last = pathParts[pathParts.length - 1];
    if (!last) return null;
    pathParts[pathParts.length - 1] = last.replace(/\.[a-z0-9]+$/i, "");
    return pathParts.join("/");
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }

    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
    }
    const bodyRecord = typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : null;
    const publicId = typeof bodyRecord?.publicId === "string" ? bodyRecord.publicId.trim() : "";

    if (!publicId || !isSafePublicId(publicId)) {
      return NextResponse.json({ error: "Invalid public ID." }, { status: 400 });
    }

    let allowed = user.role === "admin";
    if (!allowed && publicId.startsWith("cms/") && user.permissions.cms === true) {
      allowed = true;
    }
    if (!allowed && publicId.startsWith(`profiles/${user.uid}/`)) {
      allowed = true;
    }
    if (!allowed) {
      const profile = await getAdminFirestore().collection("users").doc(user.uid).get();
      const storedPublicId = publicIdFromCloudinaryUrl(String(profile.data()?.profilePicture || ""));
      allowed = storedPublicId === publicId;
    }
    if (!allowed) {
      return NextResponse.json({ error: "You are not allowed to delete this file." }, { status: 403 });
    }

    await cloudinary.uploader.destroy(publicId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Cloudinary Delete Error]", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Delete failed. Please try again." }, { status: 500 });
  }
}
