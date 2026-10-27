import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { main } from "./migrate-resource-identities.mts"

const sdk = vi.hoisted(() => ({
  readFile: vi.fn(), initializeApp: vi.fn(), cert: vi.fn(), deleteApp: vi.fn(), getFirestore: vi.fn(),
}))
vi.mock("node:fs/promises", () => ({ readFile: sdk.readFile }))
vi.mock("firebase-admin/app", () => ({ initializeApp: sdk.initializeApp, cert: sdk.cert, deleteApp: sdk.deleteApp }))
vi.mock("firebase-admin/firestore", () => ({ getFirestore: sdk.getFirestore, FieldPath: { documentId: () => "__name__" } }))

type Data = Record<string, unknown>
type Ref = { path: string }
type Transaction = { getAll: (...refs: Ref[]) => Promise<unknown[]>; update: (ref: Ref, patch: Data) => void }
const apply = ["--apply", "--maintenance-window"]
const mappingArgs = ["--mapping", "offline-fixture.json"]
let documents: Map<string, Data>
let catalog: { venues: Data[]; offices: Data[] }
let beforeTransaction: (() => void) | undefined
let retry: (() => void) | undefined
let updates: Array<{ path: string; patch: Data }>
let reads: string[][]
let log: ReturnType<typeof vi.spyOn>
let errorLog: ReturnType<typeof vi.spyOn>
const snapshot = (path: string, projected?: Data) => ({
  id: path.split("/")[1], ref: { path }, exists: documents.has(path),
  data: () => structuredClone(projected || documents.get(path)),
})
const db = {
  terminate: vi.fn(async () => {}),
  doc: (path: string) => ({ path, get: async () => snapshot(path) }),
  collection: (collection: string) => {
    let cursor = ""
    let size = 0
    let fields: string[] = []
    const query = {
      select: (...values: string[]) => { fields = values; return query },
      orderBy: () => query,
      limit: (value: number) => { size = value; return query },
      startAfter: (value: string) => { cursor = value; return query },
      get: async () => {
        const docs = [...documents.keys()].sort().filter((path) => path.startsWith(`${collection}/`) && path.split("/")[1] > cursor)
          .slice(0, size).map((path) => snapshot(path, Object.fromEntries(fields.map((field) => [field, documents.get(path)![field]]))))
        return { empty: !docs.length, docs }
      },
    }
    return query
  },
  runTransaction: vi.fn(async (body: (transaction: Transaction) => Promise<string>) => {
    beforeTransaction?.()
    let staged: typeof updates = []
    const transaction = {
      getAll: async (...refs: Ref[]) => { reads.push(refs.map((ref) => ref.path)); return refs.map((ref) => snapshot(ref.path)) },
      update: (ref: Ref, patch: Data) => { staged.push({ path: ref.path, patch }) },
    }
    let result = await body(transaction)
    if (retry) {
      retry()
      staged = []
      result = await body(transaction)
    }
    for (const update of staged) documents.set(update.path, { ...documents.get(update.path), ...update.patch })
    updates.push(...staged)
    return result
  }),
}
const output = (): Array<{ path: string; status: string }> => log.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])))
const mapping = (value: unknown) => sdk.readFile.mockResolvedValue(JSON.stringify(value))

beforeEach(() => {
  vi.clearAllMocks()
  log = vi.spyOn(console, "log").mockImplementation(() => {})
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-offline-migration")
  vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "offline@example.invalid")
  vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "offline\\nkey")
  catalog = {
    venues: [{ id: "venue-a", name: "Hall", legacyNames: ["Original Hall"] }, { id: "venue-b", name: "Other Hall" }],
    offices: [{ id: "office-a", name: "Office", rooms: [{ id: "room-a", name: "Room A", legacyNames: ["Original Room"] }] }],
  }
  documents = new Map([["cms/data", catalog]])
  beforeTransaction = undefined
  retry = undefined
  updates = []
  reads = []
  sdk.getFirestore.mockReturnValue(db)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe("offline resource identity CLI", () => {
  it("shows help and refuses invalid/unguarded apply flags before reading files or initializing Firebase", async () => {
    expect(await main(["--help"])).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("DRY RUN"))
    await expect(main(["--apply", ...mappingArgs])).rejects.toThrow("--maintenance-window")
    await expect(main(["--unknown"])).rejects.toThrow("Invalid arguments")
    expect(sdk.readFile).not.toHaveBeenCalled()
    expect(sdk.initializeApp).not.toHaveBeenCalled()
  })

  it("defaults to read-only across all collections and never reports labels or payloads", async () => {
    documents.set("bookings/b", { venue: "Original Hall", userInfo: { name: "PRIVATE_USER" }, date: "PRIVATE_DATE", receipt: "PRIVATE_RECEIPT" })
    documents.set("maintenanceRecords/m", { type: "office", spaceName: "Office" })
    documents.set("officeRentals/r", { officeSpaceId: "room-a", officeSpaceName: "PRIVATE_LABEL" })
    const before = structuredClone(documents)
    expect(await main([])).toBe(0)
    expect(documents).toEqual(before)
    expect(db.runTransaction).not.toHaveBeenCalled()
    expect(updates).toEqual([])
    expect(output()).toEqual(["bookings/b", "maintenanceRecords/m", "officeRentals/r"]
      .map((path) => ({ path, status: "resolved-would-update" })))
    expect(JSON.stringify([...log.mock.calls, ...errorLog.mock.calls])).not.toMatch(/PRIVATE_|Original Hall|Room A/)
    expect(output().every((line) => Object.keys(line).sort().join() === "path,status")).toBe(true)
    expect(db.terminate).toHaveBeenCalledOnce()
    expect(sdk.deleteApp).toHaveBeenCalledOnce()
  })

  it("changes only each collection's allowlisted fields and is idempotent", async () => {
    const retained = { venue: "Original Hall", date: "2027-01-01", updatedAt: "unchanged", paymentReceipts: [{ amount: 123 }], name: "PRIVATE_USER" }
    documents.set("bookings/b", retained)
    documents.set("bookings/office", { officeId: "office-a", roomName: "Original Room", bookingCategory: "office" })
    documents.set("maintenanceRecords/m", { type: "office", spaceName: "Office", reason: "unchanged" })
    documents.set("maintenanceRecords/room", { type: "office", spaceId: "room-a" })
    documents.set("officeRentals/r", { officeSpaceId: "room-a", monthlyRent: 123 })
    expect(await main(apply)).toBe(0)
    expect(documents.get("bookings/b")).toEqual({ ...retained, venueId: "venue-a", officeId: "", spaceId: "venue-a",
      bookingCategory: "venue", bookingType: "venue", isOfficeRental: false })
    expect(documents.get("bookings/office")).toMatchObject({ venueId: "office-a", officeId: "office-a", spaceId: "room-a", isOfficeRental: true })
    expect(documents.get("maintenanceRecords/m")).toMatchObject({ scope: "building", officeId: "office-a", spaceId: "office-a" })
    expect(documents.get("maintenanceRecords/room")).toMatchObject({ scope: "room", officeId: "office-a", spaceId: "room-a" })
    expect(documents.get("officeRentals/r")).toEqual({ officeId: "office-a", spaceId: "room-a", officeSpaceId: "room-a", monthlyRent: 123 })
    const allowed: Record<string, string[]> = {
      bookings: ["venueId", "officeId", "spaceId", "bookingCategory", "bookingType", "isOfficeRental"],
      maintenanceRecords: ["venueId", "officeId", "spaceId", "type", "scope"], officeRentals: ["officeId", "spaceId", "officeSpaceId"],
    }
    expect(updates.every(({ path, patch }) => Object.keys(patch).every((key) => allowed[path.split("/")[0]].includes(key)))).toBe(true)
    expect(reads.every(([cms, document]) => cms === "cms/data" && document !== cms)).toBe(true)
    const count = updates.length
    log.mockClear()
    expect(await main(apply)).toBe(0)
    expect(updates).toHaveLength(count)
    expect(output().every(({ status }) => status === "resolved-unchanged")).toBe(true)
  })

  it("leaves ambiguous/unresolved records alone and applies only an explicit exact-ID mapping", async () => {
    catalog.venues[1].legacyNames = ["Original Hall"]
    documents.set("bookings/b", { venue: "Original Hall" })
    documents.set("maintenanceRecords/m", { type: "venue", spaceName: "Unknown" })
    expect(await main(apply)).toBe(2)
    expect(output()).toEqual([{ path: "bookings/b", status: "ambiguous" }, { path: "maintenanceRecords/m", status: "unresolved" }])
    expect(updates).toEqual([])
    mapping({ "bookings/b": { category: "venue", venueId: "venue-a" }, "maintenanceRecords/m": { category: "venue", venueId: "venue-b" } })
    log.mockClear()
    expect(await main([...mappingArgs, ...apply])).toBe(0)
    expect(output().every(({ status }) => status === "mapped-updated")).toBe(true)
    expect(documents.get("bookings/b")).toMatchObject({ venueId: "venue-a", venue: "Original Hall" })
    expect(documents.get("maintenanceRecords/m")).toMatchObject({ venueId: "venue-b", scope: "venue", spaceName: "Unknown" })
  })

  it.each([
    ["label target", "bookings/b", { category: "venue", venueId: "Hall" }, "invalid-mapping"],
    ["wrong room parent", "bookings/b", { category: "office", venueId: "office-a", spaceId: "missing" }, "invalid-mapping"],
    ["different resolved resource", "bookings/b", { category: "venue", venueId: "venue-b" }, "mapping-conflict"],
    ["non-office rental", "officeRentals/r", { category: "venue", venueId: "venue-a" }, "invalid-mapping"],
    ["missing document", "bookings/missing", { category: "venue", venueId: "venue-a" }, "missing-document"],
  ])("rejects %s before any writes", async (_name, path, target, status) => {
    documents.set("bookings/b", { venueId: "venue-a" })
    documents.set("officeRentals/r", { officeSpaceId: "room-a" })
    mapping({ [path]: target })
    expect(await main([...mappingArgs, ...apply])).toBe(2)
    expect(output()).toEqual([{ path, status }])
    expect(db.runTransaction).not.toHaveBeenCalled()
  })

  it.each([
    { "payments/p": { category: "venue", venueId: "venue-a" } },
    { "bookings/b": { category: "venue", venueId: " venue-a" } },
    { "bookings/b": { category: "venue", venueId: "venue-a", name: "PRIVATE_LABEL" } },
  ])("rejects malformed mapping input without initializing Firebase", async (value) => {
    mapping(value)
    await expect(main(mappingArgs)).rejects.toThrow("Invalid mapping shape")
    expect(sdk.initializeApp).not.toHaveBeenCalled()
  })

  it("withholds raw mapping parser errors and rejects missing credentials before SDK initialization", async () => {
    sdk.readFile.mockResolvedValue("{PRIVATE_USER")
    await expect(main(mappingArgs)).rejects.toThrow("Cannot read/parse mapping JSON; file and parser details withheld.")
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "")
    await expect(main([])).rejects.toThrow("Required environment")
    expect(sdk.initializeApp).not.toHaveBeenCalled()
  })

  it("supports explicit room/building mappings to archived IDs without changing labels", async () => {
    catalog.offices[0].isArchived = true
    catalog.offices[0].rooms = [{ id: "room-a", name: "Room A", isArchived: true }]
    documents.set("maintenanceRecords/building", { type: "office", spaceName: "Historical Building" })
    documents.set("maintenanceRecords/room", { type: "office", spaceName: "Historical Room" })
    documents.set("officeRentals/r", { officeSpaceName: "Historical Rental" })
    mapping({
      "maintenanceRecords/building": { category: "office", venueId: "office-a" },
      "maintenanceRecords/room": { category: "office", venueId: "office-a", spaceId: "room-a" },
      "officeRentals/r": { category: "office", venueId: "office-a", spaceId: "room-a" },
    })
    expect(await main([...mappingArgs, ...apply])).toBe(0)
    expect(documents.get("maintenanceRecords/building")).toMatchObject({ spaceId: "office-a", scope: "building", spaceName: "Historical Building" })
    expect(documents.get("maintenanceRecords/room")).toMatchObject({ spaceId: "room-a", scope: "room", spaceName: "Historical Room" })
    expect(documents.get("officeRentals/r")).toMatchObject({ officeId: "office-a", officeSpaceId: "room-a", officeSpaceName: "Historical Rental" })
    log.mockClear()
    expect(await main([...mappingArgs, ...apply])).toBe(0)
    expect(output().every(({ status }) => status === "mapped-unchanged")).toBe(true)
    expect(updates).toHaveLength(3)
  })

  it.each(["venue", "office", "room", "duplicate", "padded"])("blocks incomplete/invalid catalog: %s", async (kind) => {
    if (kind === "venue") delete catalog.venues[0].id
    if (kind === "office") delete catalog.offices[0].id
    if (kind === "room") catalog.offices[0].rooms = [{ name: "PRIVATE_LABEL" }]
    if (kind === "duplicate") catalog.venues.push({ id: "venue-a", name: "PRIVATE_LABEL" })
    if (kind === "padded") catalog.venues[0].id = " venue-a "
    documents.set("bookings/b", { venue: "Original Hall" })
    expect(await main(apply)).toBe(2)
    expect(output()[0]).toMatchObject({ path: "cms/data", status: expect.stringContaining("catalog-") })
    expect(db.runTransaction).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_LABEL")
  })

  it("refuses a mapping that leaves conflicting references outside the allowlist", async () => {
    documents.set("bookings/b", { roomId: "unknown-room" })
    mapping({ "bookings/b": { category: "office", venueId: "office-a", spaceId: "room-a" } })
    expect(await main([...mappingArgs, ...apply])).toBe(2)
    expect(output()).toEqual([{ path: "bookings/b", status: "verification-failed" }])
    expect(updates).toEqual([])
  })

  it("re-resolves fresh documents on transaction retries and never commits a changed target", async () => {
    documents.set("bookings/b", { venue: "Original Hall" })
    retry = () => documents.set("bookings/b", { venue: "Other Hall" })
    expect(await main(apply)).toBe(2)
    expect(reads).toEqual([["cms/data", "bookings/b"], ["cms/data", "bookings/b"]])
    expect(output()).toEqual([{ path: "bookings/b", status: "changed-since-audit" }])
    expect(updates).toEqual([])
  })

  it("revalidates a manual target against the transaction's fresh catalog", async () => {
    documents.set("bookings/b", { venue: "Unknown" })
    mapping({ "bookings/b": { category: "office", venueId: "office-a", spaceId: "room-a" } })
    beforeTransaction = () => { catalog.offices[0].rooms = [] }
    expect(await main([...mappingArgs, ...apply])).toBe(2)
    expect(output()).toEqual([{ path: "bookings/b", status: "invalid-mapping" }])
    expect(updates).toEqual([])
  })

  it.each(["deleted-document", "invalid-catalog"])("refuses writes after a fresh read finds %s", async (kind) => {
    documents.set("bookings/b", { venueId: "venue-a" })
    beforeTransaction = () => {
      if (kind === "deleted-document") documents.delete("bookings/b")
      else delete catalog.venues[0].id
    }
    expect(await main(apply)).toBe(2)
    expect(output()).toEqual([{ path: "bookings/b", status: kind === "deleted-document" ? "missing-document" : "catalog-repair-required" }])
    expect(updates).toEqual([])
  })

  it("uses fresh canonical values to avoid an unnecessary transaction update", async () => {
    documents.set("bookings/b", { venueId: "venue-a" })
    beforeTransaction = () => documents.set("bookings/b", { venueId: "venue-a", officeId: "", spaceId: "venue-a",
      bookingCategory: "venue", bookingType: "venue", isOfficeRental: false })
    expect(await main(apply)).toBe(0)
    expect(output()).toEqual([{ path: "bookings/b", status: "resolved-unchanged" }])
    expect(updates).toEqual([])
  })

  it("paginates rather than stopping at the first 200 documents", async () => {
    for (let i = 0; i < 201; i++) documents.set(`bookings/b${String(i).padStart(3, "0")}`, { venueId: "venue-a" })
    expect(await main(["--maintenance-window"])).toBe(0)
    expect(output()).toHaveLength(201)
    expect(db.runTransaction).not.toHaveBeenCalled()
  })
})
