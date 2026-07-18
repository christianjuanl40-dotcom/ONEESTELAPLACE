import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { publicId } = body;

    if (!publicId) {
      return Response.json({ error: "No publicId provided" }, { status: 400 });
    }

    await cloudinary.uploader.destroy(publicId);

    return Response.json({ success: true });
  } catch (error: any) {
    console.error("[Cloudinary Delete Error]", error);
    return Response.json(
      { error: error?.message || "Delete failed" },
      { status: 500 },
    );
  }
}
