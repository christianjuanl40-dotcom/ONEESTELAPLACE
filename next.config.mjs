import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isStagingRuntime = process.env.ONEESTELA_ENV === "staging"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep staging development bundles separate from the normal .next output,
  // which may have been built with a production .env.local in another run.
  distDir: isStagingRuntime ? ".next-staging" : ".next",
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  devIndicators: {
    buildActivity: false, // Pinapatay yung "Compiling..."
    appIsrStatus: false,  // ETO YUNG PAPATAY SA "N" NA MAY ROUTE MENU!
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
};

export default nextConfig;
