import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const CONTRACTS_DIR = path.join(process.cwd(), "public", "contracts")

const EXT_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

const VALID_CATEGORIES = ["venue", "office"] as const

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category")

    if (category && !VALID_CATEGORIES.includes(category as any)) {
      return NextResponse.json({ error: `Invalid category "${category}"` }, { status: 400 })
    }

    const categories = category ? [category] : VALID_CATEGORIES

    const result: Record<string, { fileName: string; fileType: string; fileUrl: string }[]> = {}

    for (const cat of categories) {
      const dir = path.join(CONTRACTS_DIR, cat)
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        const files = entries
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const ext = path.extname(entry.name).toLowerCase()
            const stat = fs.statSync(path.join(dir, entry.name))
            return {
              fileName: entry.name,
              fileType: EXT_MIME_MAP[ext] || "",
              fileUrl: `/contracts/${cat}/${entry.name}`,
              lastModified: stat.mtimeMs,
            }
          })
          .filter((f) => f.fileType)
          .sort((a, b) => {
            const byDate = b.lastModified - a.lastModified
            if (byDate !== 0) return byDate
            return a.fileName.localeCompare(b.fileName)
          })

        result[cat] = files
      } catch {
        result[cat] = []
      }
    }

    return NextResponse.json({ contracts: result })
  } catch {
    return NextResponse.json({ contracts: {} })
  }
}
