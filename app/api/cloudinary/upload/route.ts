import { v2 as cloudinary } from "cloudinary";

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

function validateFileType(mime: string, resourceType: string): string | null {
  if (resourceType === "image" || resourceType === "auto") {
    if (ALLOWED_IMAGE_TYPES.includes(mime)) return "image";
    if (ALLOWED_DOCUMENT_TYPES.includes(mime)) return "raw";
    return null;
  }
  if (resourceType === "raw") {
    if (ALLOWED_DOCUMENT_TYPES.includes(mime)) return "raw";
    return null;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "uploads";
    const resourceType = (formData.get("resourceType") as string) || "image";

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const validated = validateFileType(file.type, resourceType);
    if (!validated) {
      return Response.json(
        { error: "Unsupported file type. Allowed: jpg, jpeg, png, webp, pdf, doc, docx." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: validated as "image" | "raw",
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
      uploadStream.end(buffer);
    });

    return Response.json({
      url: result.url,
      secureUrl: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
      width: result.width || 0,
      height: result.height || 0,
    });
  } catch (error: any) {
    console.error("[Cloudinary Upload Error]", error);
    return Response.json(
      { error: error?.message || "Upload failed" },
      { status: 500 },
    );
  }
}
