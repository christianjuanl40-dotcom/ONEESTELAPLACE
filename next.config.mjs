import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  devIndicators: {
    buildActivity: false, // Pinapatay yung "Compiling..."
    appIsrStatus: false,  // ETO YUNG PAPATAY SA "N" NA MAY ROUTE MENU!
  },
};

export default nextConfig;
