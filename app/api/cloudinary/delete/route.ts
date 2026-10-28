import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError, requireAuthenticatedUser } from "@/lib/server-auth";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 16 * 1024;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

type CloudinaryResourceType = "image" | "raw";

function isSafePublicId(publicId: string): boolean {
  return publicId.length <= 200
    && /^[a-z0-9][a-z0-9._/-]*$/i.test(publicId)
    && !publicId.includes("..")
    && !publicId.includes("//")
    && !publicId.endsWith("/");
}

function isOwnedProfileAsset(publicId: string, uid: string): boolean {
  const prefix = `profiles/${uid}/`;
  return publicId.startsWith(prefix) && publicId.length > prefix.length;
}

function isCmsAsset(publicId: string): boolean {
  return publicId.startsWith("cms/") && publicId.length > "cms/".length;
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
    const requestedResourceType = typeof bodyRecord?.resourceType === "string"
      ? bodyRecord.resourceType.trim().toLowerCase()
      : "image";

    if (!publicId || !isSafePublicId(publicId)) {
      return NextResponse.json({ error: "Invalid public ID." }, { status: 400 });
    }
    if (requestedResourceType !== "image" && requestedResourceType !== "raw") {
      return NextResponse.json({ error: "Unsupported Cloudinary resource type." }, { status: 400 });
    }
    const resourceType = requestedResourceType as CloudinaryResourceType;

    // Ownership is established by a server-enforced namespace, never by the
    // editable profilePicture URL. Legacy URLs without this namespace fail
    // closed and can be removed from the profile without authorizing deletion.
    const ownsProfileAsset = isOwnedProfileAsset(publicId, user.uid) && resourceType === "image";
    const managesCmsAssets = isCmsAsset(publicId)
      && (user.role === "admin" || user.permissions.cms === true);
    const allowed = ownsProfileAsset || managesCmsAssets;
    if (!allowed) {
      return NextResponse.json({ error: "You are not allowed to delete this file." }, { status: 403 });
    }

    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: "upload" });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Cloudinary Delete Error]", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Delete failed. Please try again." }, { status: 500 });
  }
}
