import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { getCatalogAvailabilitySpace, resolveResourceSpace } from "../src/modules/shared/lib/resource-identity.ts"
import type { AvailabilityCategory, AvailabilitySpace } from "../src/modules/shared/lib/availability.ts"

type Data = Record<string, unknown>
type Patch = Record<string, string | boolean>
type Mapping = { category: AvailabilityCategory; venueId: string; spaceId?: string }
type Plan = { status: "ambiguous" | "unresolved" | "invalid-mapping" | "mapping-conflict" | "verification-failed" }
  | { status: "resolved" | "mapped"; space: AvailabilitySpace; patch: Patch }
const collections = { bookings: "booking", maintenanceRecords: "maintenance", officeRentals: "rental" } as const
type Collection = keyof typeof collections
const identityFields = ["venueId", "officeId", "spaceId", "officeSpaceId", "roomId", "bookingCategory",
  "bookingType", "rentalType", "isOfficeRental", "type", "scope", "roomName", "venue", "spaceName", "officeSpaceName", "name"]
const isData = (value: unknown): value is Data => Boolean(value && typeof value === "object" && !Array.isArray(value))
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.trim()
const sameSpace = (a: AvailabilitySpace, b: AvailabilitySpace) =>
  a.category === b.category && a.venueId === b.venueId && a.spaceId === b.spaceId
const report = (path: string, status: string) => console.log(JSON.stringify({ path, status }))
class CliError extends Error {}

const help = `Resource identity audit/migration (default: DRY RUN)
Usage: node --env-file=.env.local --experimental-strip-types scripts/migrate-resource-identities.mts [options]
  --mapping <file.json>   Human-verified document-path mappings to exact catalog IDs
  --apply                Write identity fields only; requires --maintenance-window
  --maintenance-window   Acknowledge all live writers, schedulers and old clients are stopped
  --help, -h             Show help without reading credentials or contacting Firebase

Mapping: {"bookings/DOCUMENT_ID":{"category":"office","venueId":"OFFICE_ID","spaceId":"ROOM_ID"}}
Omit spaceId for an office building; venue spaceId, if supplied, must equal venueId.
No schedule locks/conflict checks are performed. Back up and verify mappings first.
Output: JSON lines containing document paths and statuses only (mode on stderr).
Exit codes: 0 complete, 2 manual action required, 1 failure (apply can be partial).`

function catalogIssues(catalog: Data): string[] {
  const issues = new Set<string>()
  for (const category of ["venue", "office"] as const) {
    const items = catalog[category === "venue" ? "venues" : "offices"]
    if (!Array.isArray(items)) {
      issues.add(`catalog-invalid-${category}-list`)
      continue
    }
    const ids = new Set<string>()
    for (const item of items) {
      if (!isData(item)) {
        issues.add(`catalog-invalid-${category}`)
        continue
      }
      if (!isId(item.id)) issues.add(`catalog-missing-or-invalid-${category}-id`)
      else if (ids.has(item.id)) issues.add(`catalog-duplicate-${category}-id`)
      else ids.add(item.id)
      if (category !== "office" || item.rooms === undefined) continue
      if (!Array.isArray(item.rooms)) {
        issues.add("catalog-invalid-room-list")
        continue
      }
      const roomIds = new Set<unknown>([item.id])
      for (const room of item.rooms) {
        if (!isData(room) || !isId(room.id)) issues.add("catalog-missing-or-invalid-room-id")
        else if (roomIds.has(room.id)) issues.add("catalog-duplicate-room-id")
        else roomIds.add(room.id)
      }
    }
  }
  return [...issues]
}

async function readMappings(file?: string): Promise<Map<string, Mapping>> {
  if (!file) return new Map()
  let data: unknown
  try { data = JSON.parse(await readFile(file, "utf8")) }
  catch { throw new CliError("Cannot read/parse mapping JSON; file and parser details withheld.") }
  if (!isData(data)) throw new CliError("Mapping JSON must be an object keyed by document path.")
  const mappings = new Map<string, Mapping>()
  for (const [path, value] of Object.entries(data)) {
    const parts = path.split("/")
    if (parts.length !== 2 || !Object.hasOwn(collections, parts[0]) || !parts[1] || [".", ".."].includes(parts[1])
      || !isData(value) || (value.category !== "venue" && value.category !== "office") || !isId(value.venueId)
      || (value.spaceId !== undefined && !isId(value.spaceId))
      || Object.keys(value).some((key) => !["category", "venueId", "spaceId"].includes(key))) {
      throw new CliError("Invalid mapping shape; use collection/document IDs and {category, venueId, spaceId?} only.")
    }
    mappings.set(path, value as Mapping)
  }
  return mappings
}

function mappedSpace(catalog: Data, collection: Collection, mapping: Mapping): AvailabilitySpace | null {
  if (collection === "officeRentals" && mapping.category !== "office") return null
  if (mapping.category === "venue" && mapping.spaceId && mapping.spaceId !== mapping.venueId) return null
  const roomId = mapping.category === "office" && mapping.spaceId !== mapping.venueId ? mapping.spaceId : undefined
  return getCatalogAvailabilitySpace(catalog, mapping.category, mapping.venueId, roomId, true)
}

function plan(catalog: Data, record: Data, collection: Collection, mapping?: Mapping): Plan {
  const kind = collections[collection]
  const resolution = resolveResourceSpace(catalog, record, kind)
  let space = resolution.status === "resolved" ? resolution.space : undefined
  if (mapping) {
    const mapped = mappedSpace(catalog, collection, mapping)
    if (!mapped) return { status: "invalid-mapping" }
    if (space && !sameSpace(space, mapped)) return { status: "mapping-conflict" }
    space = mapped
  }
  if (!space) return { status: resolution.status === "ambiguous" ? "ambiguous" : "unresolved" }
  const office = space.category === "office"
  const spaceId = space.spaceId || space.venueId
  const canonical: Patch = collection === "officeRentals"
    ? { officeId: space.venueId, spaceId, officeSpaceId: spaceId }
    : { venueId: space.venueId, officeId: office ? space.venueId : "", spaceId,
        ...(collection === "bookings"
          ? { bookingCategory: space.category, bookingType: space.category, isOfficeRental: office }
          : { type: space.category, scope: office ? (spaceId === space.venueId ? "building" : "room") : "venue" }) }
  // Retained legacy references must still agree. Never "fix" a resolution by deleting other fields.
  const verified = resolveResourceSpace(catalog, { ...record, ...canonical }, kind)
  if (verified.status !== "resolved" || !sameSpace(verified.space, space)) return { status: "verification-failed" }
  return { status: mapping ? "mapped" : "resolved", space,
    patch: Object.fromEntries(Object.entries(canonical).filter(([key, value]) => record[key] !== value)) }
}

export async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help)
    return 0
  }
  let apply = false
  let maintenanceWindow = false
  let mappingFile: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true
    else if (args[i] === "--maintenance-window") maintenanceWindow = true
    else if (args[i] === "--mapping" && !mappingFile && args[i + 1] && !args[i + 1].startsWith("--")) mappingFile = args[++i]
    else throw new CliError("Invalid arguments. Use --help.")
  }
  if (apply && !maintenanceWindow) throw new CliError("--apply requires --maintenance-window; stop all live writers, schedulers and old clients first.")
  const mappings = await readMappings(mappingFile)
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKey) {
    throw new CliError("Required environment: NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.")
  }
  // Do not import the app's server-only initializer or initialize Firebase for --help/invalid flags.
  const { initializeApp, cert, deleteApp } = await import("firebase-admin/app")
  const { getFirestore, FieldPath } = await import("firebase-admin/firestore")
  const app = initializeApp({ projectId, credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") }) }, "resource-identity-migration")
  let db: ReturnType<typeof getFirestore> | undefined
  try {
    console.error(apply ? "APPLY: maintenance window acknowledged; no schedule conflict checks." : "DRY RUN: no writes.")
    db = getFirestore(app)
    const cmsRef = db.doc("cms/data")
    const cms = await cmsRef.get()
    if (!cms.exists) {
      report(cmsRef.path, "catalog-missing")
      return 2
    }
    const catalog = cms.data()!
    const issues = catalogIssues(catalog)
    if (issues.length) {
      for (const issue of issues) report(cmsRef.path, issue)
      return 2
    }
    // Validate every supplied mapping before any writes, including document existence.
    let blocked = false
    for (const [path, mapping] of mappings) {
      const snapshot = await db.doc(path).get()
      const result = snapshot.exists ? plan(catalog, snapshot.data()!, path.split("/")[0] as Collection, mapping) : null
      if (!result || !("patch" in result)) {
        report(path, result?.status || "missing-document")
        blocked = true
      }
    }
    if (blocked) return 2
    for (const collection of Object.keys(collections) as Collection[]) {
      let cursor: string | undefined
      while (true) {
        let query = db.collection(collection).select(...identityFields).orderBy(FieldPath.documentId()).limit(200)
        if (cursor) query = query.startAfter(cursor)
        const page = await query.get()
        if (page.empty) break
        for (const snapshot of page.docs) {
          const mapping = mappings.get(snapshot.ref.path)
          const initial = plan(catalog, snapshot.data(), collection, mapping)
          if (!("patch" in initial)) {
            report(snapshot.ref.path, initial.status)
            blocked = true
            continue
          }
          let status = `${initial.status}-${Object.keys(initial.patch).length ? "would-update" : "unchanged"}`
          if (apply) {
            status = await db.runTransaction(async (transaction) => {
              const [currentCms, currentDocument] = await transaction.getAll(cmsRef, snapshot.ref)
              if (!currentDocument.exists) return "missing-document"
              if (!currentCms.exists || catalogIssues(currentCms.data()!).length) return "catalog-repair-required"
              const current = plan(currentCms.data()!, currentDocument.data()!, collection, mapping)
              if (!("patch" in current)) return current.status
              if (!sameSpace(initial.space, current.space)) return "changed-since-audit"
              if (!Object.keys(current.patch).length) return `${current.status}-unchanged`
              transaction.update(snapshot.ref, current.patch)
              return `${current.status}-updated`
            })
          }
          report(snapshot.ref.path, status)
          if (!status.endsWith("-updated") && !status.endsWith("-would-update") && !status.endsWith("-unchanged")) blocked = true
        }
        cursor = page.docs[page.docs.length - 1].id
      }
    }
    return blocked ? 2 : 0
  } finally {
    // Deleting the Admin app alone does not close Firestore channels.
    try { await db?.terminate() }
    finally { await deleteApp(app) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)) }
  catch (error) {
    console.error(error instanceof CliError ? error.message : "Migration failed; SDK/file details withheld to avoid exposing data. An apply may be partial; audit before retrying.")
    process.exitCode = 1
  }
}
