// app/robots.ts
import type { MetadataRoute } from "next"

const BASE_URL = "https://oneestelaplace.vercel.app"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/portal/", "/dashboard/", "/api/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
