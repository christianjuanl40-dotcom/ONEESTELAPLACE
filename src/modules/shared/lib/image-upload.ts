import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from "./cloudinary";

export function validateImageFile(file: File, isPanorama = false) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Only JPG, PNG, and WebP images are allowed.");
  }
  const maxSize = isPanorama ? 10 * 1024 * 1024 : 2.5 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(
      isPanorama
        ? "File size exceeds 10MB limit for panoramas."
        : "File size exceeds 2.5MB limit.",
    );
  }
}

export async function uploadCMSImage(file: File, storagePath = "images") {
  const result = await uploadToCloudinary(file, { folder: `cms/${storagePath}` });
  return result.secureUrl;
}

export async function deleteCMSImage(imageUrl: string) {
  try {
    const publicId = extractPublicId(imageUrl);
    if (publicId) {
      await deleteFromCloudinary(publicId);
    }
  } catch (error) {
    console.warn("[deleteCMSImage] Failed to delete:", error);
  }
}

export async function removeImage(value: string) {
  if (value) {
    await deleteCMSImage(value);
  }
  return "";
}
