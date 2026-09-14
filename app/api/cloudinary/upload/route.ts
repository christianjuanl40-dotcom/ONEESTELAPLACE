import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser, isApiAuthError } from "@/lib/server-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;

function validateFileType(mime: string, resourceType: string): "image" | "raw" | null {
  if (resourceType === "image" && ALLOWED_IMAGE_TYPES.includes(mime)) return "image";
  if (resourceType === "raw" && ALLOWED_DOCUMENT_TYPES.includes(mime)) return "raw";
  return null;
}

function isSafeFolder(folder: string): boolean {
  return folder.length <= 120 && /^[a-z0-9][a-z0-9/_-]*$/i.test(folder) && !folder.includes("..")
}

function hasFileSignature(buffer: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return buffer.subarray(0, 2).toString("ascii") === "PK";
  if (mime === "application/msword") return buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  return false;
}

async function canUploadToFolder(
  folder: string,
  user: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
): Promise<{ folder: string; maxBytes: number } | null> {
  if (folder === "profiles") {
    return { folder: `profiles/${user.uid}`, maxBytes: MAX_PROFILE_BYTES };
  }

  if (folder.startsWith("cms/") && (user.role === "admin" || user.permissions.cms === true)) {
    return { folder, maxBytes: MAX_UPLOAD_BYTES };
  }

  const paymentMatch = folder.match(/^payment-proofs\/([a-z0-9_-]+)$/i);
  if (paymentMatch) {
    if (user.role === "admin" || user.permissions.payments === true) {
      return { folder, maxBytes: MAX_UPLOAD_BYTES };
    }

    const booking = await getAdminFirestore().collection("bookings").doc(paymentMatch[1]).get();
    const bookingData = booking.data();
    if (bookingData?.userId === user.uid || bookingData?.customerId === user.uid) {
      return { folder, maxBytes: MAX_UPLOAD_BYTES };
    }
  }

  const chatMatch = folder.match(/^chat\/([a-z0-9_-]+)$/i);
  if (chatMatch && (user.role === "admin" || user.permissions.chat === true || chatMatch[1] === user.uid)) {
    return { folder, maxBytes: 5 * 1024 * 1024 };
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES + 256 * 1024) {
      return NextResponse.json({ error: "File is too large." }, { status: 413 });
    }

    const formData = await request.formData();
    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;
    const requestedFolder = typeof formData.get("folder") === "string" ? String(formData.get("folder")).trim() : "";
    const resourceType = typeof formData.get("resourceType") === "string" ? String(formData.get("resourceType")) : "image";

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (!isSafeFolder(requestedFolder)) {
      return NextResponse.json({ error: "Invalid upload folder." }, { status: 400 });
    }

    const destination = await canUploadToFolder(requestedFolder, user);
    if (!destination) {
      return NextResponse.json({ error: "You are not allowed to upload to this location." }, { status: 403 });
    }

    const validated = validateFileType(file.type, resourceType);
    if (!validated) {
      return NextResponse.json(
        { error: "Unsupported file type for this upload." },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > destination.maxBytes) {
      return NextResponse.json({ error: "File is too large." }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!hasFileSignature(buffer, file.type)) {
      return NextResponse.json({ error: "The file contents do not match the selected file type." }, { status: 400 });
    }

    type CloudinaryUploadResponse = {
      url?: string;
      secure_url?: string;
      public_id?: string;
      format?: string;
      bytes?: number;
      width?: number;
      height?: number;
    };

    const result = await new Promise<CloudinaryUploadResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: destination.folder,
          resource_type: validated as "image" | "raw",
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) reject(error);
          else if (result) resolve(result);
          else reject(new Error("Cloudinary returned no upload result."));
        },
      );
      uploadStream.end(buffer);
    });

    if (!result.secure_url && !result.url) {
      throw new Error("Cloudinary returned no asset URL.");
    }
    if (!result.public_id) {
      throw new Error("Cloudinary returned no asset ID.");
    }

    return NextResponse.json({
      url: result.url || result.secure_url,
      secureUrl: result.secure_url || result.url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
      width: result.width || 0,
      height: result.height || 0,
    });
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Cloudinary Upload Error]", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
