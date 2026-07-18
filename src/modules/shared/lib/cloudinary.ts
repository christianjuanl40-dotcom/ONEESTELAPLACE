export interface CloudinaryUploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

function isCloudinaryUrl(url: string): boolean {
  return url.includes("cloudinary.com");
}

export function extractPublicId(url: string): string | null {
  if (!url || !isCloudinaryUrl(url)) return null;
  try {
    const parts = url.split("/");
    const uploadIndex = parts.findIndex((p) => p === "upload");
    if (uploadIndex === -1) return null;
    const afterUpload = parts.slice(uploadIndex + 1);
    const versionIndex = afterUpload.findIndex((p) => p.startsWith("v") && /^\d+$/.test(p.slice(1)));
    const relevant = versionIndex !== -1 ? afterUpload.slice(versionIndex + 1) : afterUpload;
    const fullPath = relevant.join("/");
    const dotIndex = fullPath.lastIndexOf(".");
    return dotIndex !== -1 ? fullPath.slice(0, dotIndex) : fullPath;
  } catch {
    return null;
  }
}

export async function uploadToCloudinary(
  file: File,
  options?: { folder?: string; resourceType?: "image" | "raw" },
): Promise<CloudinaryUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", options?.folder || "uploads");
  formData.append("resourceType", options?.resourceType || "image");

  const res = await fetch("/api/cloudinary/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }

  return res.json();
}

export async function deleteFromCloudinary(publicId: string): Promise<void> {
  const res = await fetch("/api/cloudinary/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Delete failed" }));
    throw new Error(err.error || "Delete failed");
  }
}

export function validateFileType(
  file: File,
  options?: { allowDocuments?: boolean },
): string | null {
  const imageTypes = ["image/jpeg", "image/png", "image/webp"];
  const docTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (imageTypes.includes(file.type)) return "image";
  if (options?.allowDocuments && docTypes.includes(file.type)) return "raw";
  return null;
}
