import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CMSProvider, useCMS, type CMSData } from "@/src/modules/admin/contexts/cms-context"
import { getPublicSpaces, getPublicSpacesFromData, setCachedVenuesAndOffices } from "@/src/modules/client/lib/venue-data"

const boundary = vi.hoisted(() => ({
  local: null as CMSData | null,
  server: null as (CMSData & { bookingCounter?: number; futureMetadata?: unknown }) | null,
  write: vi.fn(),
  toast: vi.fn(),
  fail: false,
}))

// Exercise the provider's mutations without a browser or live Firebase services.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: CMSData) => [boundary.local ?? initial, (next: CMSData) => { boundary.local = next }],
}))
vi.mock("@/lib/firebase", () => ({ db: {} }))
vi.mock("@/src/modules/shared/hooks/use-toast", () => ({ useToast: () => ({ toast: boundary.toast }) }))
vi.mock("firebase/firestore", () => ({
  doc: () => ({ path: "cms/data" }),
  onSnapshot: vi.fn(),
  runTransaction: async (_db: unknown, action: (transaction: unknown) => Promise<unknown>) => {
    if (boundary.fail) throw new Error("Fixture save failure")
    const snapshot = structuredClone(boundary.server)
    return action({
      get: async () => ({ exists: () => snapshot !== null, data: () => snapshot }),
      set: (_ref: unknown, data: Partial<CMSData>, options: unknown) => {
        boundary.write(data, options)
        boundary.server = { ...boundary.server, ...structuredClone(data) } as CMSData
      },
    })
  },
}))

function readCMS() {
  let context!: ReturnType<typeof useCMS>
  function Capture() { context = useCMS(); return null }
  renderToStaticMarkup(createElement(CMSProvider, null, createElement(Capture)))
  return context
}

beforeEach(() => {
  boundary.local = null
  boundary.server = null
  boundary.fail = false
  boundary.write.mockClear()
  boundary.toast.mockClear()
  const defaults = readCMS().cmsData
  boundary.local = structuredClone(defaults)
  boundary.server = structuredClone(defaults)
  setCachedVenuesAndOffices([], [])
})

describe("public catalog normalization", () => {
  it("uses defaults only for absent arrays, never for empty or partial catalogs", () => {
    expect(getPublicSpacesFromData(null).eventVenues).toHaveLength(4)
    expect(getPublicSpacesFromData({}).officeSpaces).toHaveLength(2)
    expect(getPublicSpacesFromData({ venues: [], offices: [] })).toEqual({ eventVenues: [], officeSpaces: [] })
    expect(getPublicSpaces()).toEqual({ eventVenues: [], officeSpaces: [] })
    const result = getPublicSpacesFromData({ venues: [{ id: "custom", name: "Custom" }], offices: [] })
    expect(result.eventVenues.map((venue) => venue.id)).toEqual(["custom"])
    expect(result.officeSpaces).toEqual([])
  })

  it("does not exclude catalog entries by their display names", () => {
    const names = ["Grand Ballroom", "Intimate Lounge"]
    const result = getPublicSpacesFromData({ venues: names.map((name, i) => ({ id: `venue-${i}`, name })) })
    expect(result.eventVenues.map((venue) => venue.name)).toEqual(names)
  })

  it("exposes legacy hidden catalog entries as Under Renovation without hiding them", () => {
    const result = getPublicSpacesFromData({
      venues: [{ id: "legacy-venue", name: "Legacy Venue", isHidden: true }],
      offices: [{ id: "renovating-office", name: "Renovating Office", catalogStatus: "under_renovation", rooms: [] }],
    })
    expect(result.eventVenues[0]).toMatchObject({ catalogStatus: "under_renovation", isHidden: true })
    expect(result.officeSpaces[0]).toMatchObject({ catalogStatus: "under_renovation", isHidden: true })
  })

  it("preserves exact aliases, room names and IDs without deriving IDs from names", () => {
    const rooms = [{ id: "room-id", name: "  East Room  ", legacyNames: ["Room 1", "ROOM 01"] }]
    const office = { id: "office-id", name: "Renamed Office", legacyNames: ["Office A", "  Office A  "], rooms }
    const result = getPublicSpacesFromData({ offices: [office], venues: [{ name: "No ID" }] })
    expect(result.officeSpaces[0]).toMatchObject({ ...office, category: "office" })
    expect(result.eventVenues[0].id).toBe("")
    expect(rooms).toEqual(office.rooms)
    expect(getPublicSpacesFromData({ offices: [{ ...office, name: "Another Name" }] }).officeSpaces[0].id).toBe("office-id")
  })

  it("keeps empty rooms empty and distinguishes absent rooms for legacy compatibility", () => {
    const { officeSpaces } = getPublicSpacesFromData({ offices: [
      { id: "office-a", rooms: [] },
      { id: "office-b" },
      { id: "custom", rooms: [{ id: "archived", name: "Old Room", isArchived: true }] },
      { id: "invalid", rooms: null },
    ] })
    expect(officeSpaces[0].rooms).toEqual([])
    expect(officeSpaces[1]).not.toHaveProperty("rooms")
    expect(officeSpaces[2].rooms).toEqual([])
    expect(officeSpaces[3].rooms).toEqual([])
  })
})

describe("CMS catalog identity and persistence", () => {
  it("keeps venue IDs immutable and accumulates exact previous names across renames", async () => {
    const original = readCMS().venues[0]
    expect(await readCMS().updateVenue(original.id, { id: "replacement", name: "  North Hall  ", category: "office" })).toBe(true)
    expect(await readCMS().updateVenue(original.id, { name: "Grand Ballroom", legacyNames: [] })).toBe(true)
    expect(await readCMS().updateVenue(original.id, { name: original.name })).toBe(true)
    expect(readCMS().venues[0]).toMatchObject({
      id: original.id,
      name: original.name,
      category: "venue",
      legacyNames: [original.name, "  North Hall  ", "Grand Ballroom"],
    })
    expect(original).not.toHaveProperty("legacyNames")
  })

  it("keeps office and room aliases scoped to their immutable parent identities", async () => {
    expect(await readCMS().updateOffice("office-a", { id: "replacement", name: "East Wing", category: "venue" })).toBe(true)
    expect(await readCMS().updateRoomInOffice("office-a", "office-a-room-1", { id: "replacement", name: "East Room" })).toBe(true)
    expect(await readCMS().updateRoomInOffice("office-a", "office-a-room-1", { name: "Window Room", legacyNames: [] })).toBe(true)
    expect(readCMS().offices[0]).toMatchObject({ id: "office-a", category: "office", legacyNames: ["Office A"] })
    expect(readCMS().getOfficeRooms("office-a")[0]).toMatchObject({
      id: "office-a-room-1", name: "Window Room", legacyNames: ["Room 1", "East Room"],
    })
    expect(readCMS().getOfficeRooms("office-b")[0]).toEqual({ id: "office-b-room-1", name: "Room 1" })
  })

  it("persists catalog status changes without replacing office metadata", async () => {
    const cms = readCMS()
    const originalRoomIds = cms.getOfficeRooms("office-a").map((room) => room.id)
    expect(await cms.updateOffice("office-a", { floor: "Second Floor" })).toBe(true)
    expect(await readCMS().updateOffice("office-a", { catalogStatus: "under_renovation" })).toBe(true)
    expect(readCMS().offices[0]).toMatchObject({ catalogStatus: "under_renovation", isHidden: true, floor: "Second Floor" })
    expect(readCMS().getOfficeRooms("office-a").map((room) => room.id)).toEqual(originalRoomIds)
    expect(await readCMS().updateOffice("office-a", { catalogStatus: "published" })).toBe(true)
    expect(readCMS().offices[0]).toMatchObject({ catalogStatus: "published", isHidden: false, floor: "Second Floor" })
  })

  it("generates UUIDs after spreading caller data for every catalog addition", async () => {
    await readCMS().addVenue({ id: undefined, name: "New Venue", category: "office" })
    await readCMS().addOffice({ id: "caller-id", name: "New Office", rooms: [{ id: "caller-room-id", name: "First" }] })
    const rooms = [{ id: "caller-id", name: "Second" }, { id: undefined, name: "Third" }]
    await readCMS().addRoomsToOffice("office-a", rooms)
    await readCMS().addRoomToOffice("office-a", { name: "Fourth" })
    const cms = readCMS()
    const addedVenue = cms.venues.at(-1)!
    const addedOffice = cms.offices.at(-1)!
    const addedRooms = [...addedOffice.rooms, ...cms.getOfficeRooms("office-a").slice(8)]
    const ids = [addedVenue.id, addedOffice.id, ...addedRooms.map((room) => room.id)]
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    for (const id of ids) expect(id).toMatch(uuid)
    expect(new Set(ids).size).toBe(ids.length)
    expect(addedVenue.category).toBe("venue")
    expect(addedOffice.category).toBe("office")
    expect(addedVenue).toMatchObject({ catalogStatus: "published", isHidden: false })
    expect(addedOffice).toMatchObject({ catalogStatus: "published", isHidden: false })
  })

  it("archives rooms without removing their IDs or aliases", async () => {
    await readCMS().updateRoomInOffice("office-a", "office-a-room-1", { name: "Renamed Room" })
    expect(await readCMS().deleteRoomFromOffice("office-a", "office-a-room-1")).toBe(true)
    expect(readCMS().offices[0].rooms).toHaveLength(8)
    expect(readCMS().offices[0].rooms[0]).toMatchObject({
      id: "office-a-room-1", name: "Renamed Room", legacyNames: ["Room 1"], isArchived: true,
    })
    expect(readCMS().getOfficeRooms("office-a")).toHaveLength(7)
  })

  it("does not inject defaults into explicit empty arrays", async () => {
    const cms = readCMS()
    await cms.saveCMSData({ ...cms.cmsData, venues: [], offices: [], faqs: [], policies: [], pastClientBookings: [] })
    expect(boundary.server).toMatchObject({ venues: [], offices: [], faqs: [], policies: [], pastClientBookings: [] })
    await readCMS().saveCMSData({ ...readCMS().cmsData, offices: [{ id: "office-a", rooms: [] }, { id: "office-b" }] })
    expect(readCMS().offices[0].rooms).toEqual([])
    expect(readCMS().offices[1].rooms).toHaveLength(8)
  })

  it("archives only the selected past-client showcase entry and persists the marker", async () => {
    const entries = ["deleted", "hidden", "kept"].map((id, index) => ({
      id: `showcase-${id}`,
      photos: [`/${id}.jpg`],
      coverPhoto: `/${id}.jpg`,
      name: id,
      eventName: `${id} event`,
      eventType: "Event",
      date: `2026-01-0${index + 1}`,
      testimonial: "",
      companyName: "",
      display: id !== "hidden",
      createdAt: "2026-01-01T00:00:00.000Z",
    }))
    const cms = readCMS()
    expect(await cms.saveCMSData({ ...cms.cmsData, pastClientBookings: entries })).toBe(true)

    const current = readCMS()
    expect(await current.deletePastClientBooking("showcase-deleted")).toBe(true)

    const updated = readCMS()
    expect(updated.pastClientBookings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "showcase-deleted", isArchived: true }),
      expect.objectContaining({ id: "showcase-hidden", display: false }),
      expect.objectContaining({ id: "showcase-kept", display: true }),
    ]))
    expect(updated.pastClientBookings.filter((entry) => !entry.isArchived).map((entry) => entry.id)).toEqual([
      "showcase-hidden",
      "showcase-kept",
    ])
    expect(boundary.server?.pastClientBookings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "showcase-deleted", isArchived: true }),
    ]))
  })

  it("keeps a past-client showcase entry visible when its delete save fails", async () => {
    const entry = {
      id: "showcase-failure",
      photos: ["/failure.jpg"],
      coverPhoto: "/failure.jpg",
      name: "Failure",
      eventName: "Failure event",
      eventType: "Event",
      date: "2026-01-01",
      testimonial: "",
      companyName: "",
      display: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const cms = readCMS()
    expect(await cms.saveCMSData({ ...cms.cmsData, pastClientBookings: [entry] })).toBe(true)
    const original = structuredClone(readCMS().cmsData)
    boundary.fail = true
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await readCMS().deletePastClientBooking(entry.id)).toBe(false)
      expect(boundary.local).toEqual(original)
      expect(boundary.server).toEqual(original)
      expect(boundary.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }))
    } finally {
      errorLog.mockRestore()
    }
  })

  it("writes only changed CMS sections and preserves the current server counter", async () => {
    const cms = readCMS()
    const stale = { ...structuredClone(cms.cmsData), bookingCounter: 3 }
    boundary.server = { ...cms.cmsData, bookingCounter: 42, futureMetadata: { version: 2 }, homepage: { ...cms.cmsData.homepage, heroTitle: "Latest" } }
    expect(await cms.saveCMSData({ ...stale, venues: [] })).toBe(true)
    expect(boundary.write).toHaveBeenCalledWith({ venues: [] }, { mergeFields: ["venues"] })
    expect(boundary.server).toMatchObject({ bookingCounter: 42, futureMetadata: { version: 2 }, homepage: { heroTitle: "Latest" }, venues: [] })
  })

  it.each(["add", "rename", "archive"])("rejects a stale offices save without losing another session's room %s", async (operation) => {
    const sessionA = readCMS()
    const sessionB = readCMS()
    if (operation === "add") {
      expect(await sessionA.addRoomToOffice("office-a", { name: "New UUID Room" })).toBe(true)
      expect(readCMS().getOfficeRooms("office-a").at(-1)?.id).toMatch(/^[0-9a-f-]{36}$/)
    } else {
      expect(await sessionA.updateOffice("office-a", { name: "East Wing" })).toBe(true)
      expect(await readCMS().updateRoomInOffice("office-a", "office-a-room-1", { name: "Window Room" })).toBe(true)
      if (operation === "archive") expect(await readCMS().deleteRoomFromOffice("office-a", "office-a-room-1")).toBe(true)
    }
    const latest = structuredClone(boundary.server)
    const draft = { description: "Session B's office description" }
    boundary.local = sessionB.cmsData
    boundary.write.mockClear()
    boundary.toast.mockClear()
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await sessionB.updateOffice("office-b", draft)).toBe(false)
      expect(boundary.server).toEqual(latest)
      expect(boundary.local).toEqual(sessionB.cmsData)
      expect(draft).toEqual({ description: "Session B's office description" })
      expect(boundary.write).not.toHaveBeenCalled()
      expect(boundary.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        title: "Content Changed",
        description: expect.stringMatching(/offices.*another editor.*not saved/i),
        variant: "destructive",
      }))
    } finally {
      errorLog.mockRestore()
    }
  })

  it("rejects all draft sections when a stale venue edit would erase rename aliases or archival", async () => {
    const sessionA = readCMS()
    const sessionB = readCMS()
    expect(await sessionA.updateVenue("v1", { name: "North Hall" })).toBe(true)
    const current = readCMS()
    expect(await current.saveCMSData({ ...current.cmsData, venues: current.venues.map((venue) =>
      venue.id === "v1" ? { ...venue, isArchived: true } : venue
    ) })).toBe(true)
    const latest = structuredClone(boundary.server)
    boundary.local = sessionB.cmsData
    boundary.write.mockClear()
    boundary.toast.mockClear()
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await sessionB.saveCMSData({
        ...sessionB.cmsData,
        homepage: { ...sessionB.cmsData.homepage, heroTitle: "Unsaved Draft" },
        venues: sessionB.venues.map((venue) => venue.id === "v2" ? { ...venue, description: "Stale Draft" } : venue),
      })).toBe(false)
      expect(boundary.server).toEqual(latest)
      expect(boundary.local).toEqual(sessionB.cmsData)
      expect(boundary.write).not.toHaveBeenCalled()
      expect(boundary.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Content Changed", variant: "destructive" }))
    } finally {
      errorLog.mockRestore()
    }
  })

  it("allows stale sessions to save a different section without overwriting rooms or bookingCounter", async () => {
    const sessionA = readCMS()
    const sessionB = readCMS()
    expect(await sessionA.addRoomToOffice("office-a", { name: "Another Editor's Room" })).toBe(true)
    boundary.server!.bookingCounter = 42
    const latestOffices = structuredClone(boundary.server!.offices)
    boundary.local = sessionB.cmsData
    boundary.write.mockClear()
    expect(await sessionB.updateVenue("v1", { description: "Independent Venue Edit" })).toBe(true)
    expect(boundary.server!.offices).toEqual(latestOffices)
    expect(boundary.server!.bookingCounter).toBe(42)
    expect(boundary.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ venues: expect.any(Array) }), { mergeFields: ["venues"] })
  })

  it("compares normalized sections without depending on Firestore map key ordering", async () => {
    const cms = readCMS()
    const legacy = structuredClone(cms.cmsData)
    for (const office of legacy.offices) delete office.category
    delete legacy.offices[0].rooms
    legacy.offices[1].rooms = legacy.offices[1].rooms.map((room: Record<string, unknown>) => Object.fromEntries(Object.entries(room).reverse()))
    boundary.server = { ...legacy, offices: legacy.offices.map((office) => Object.fromEntries(Object.entries(office).reverse())) as CMSData["offices"] }
    expect(await cms.updateOffice("office-b", { description: "Updated Legacy Office" })).toBe(true)
    expect(readCMS().getOfficeRooms("office-a")).toHaveLength(8)
    expect(readCMS().offices[1]).toMatchObject({ category: "office", description: "Updated Legacy Office" })
  })

  it("accepts an already-identical server draft even when the original section is stale", async () => {
    const sessionA = readCMS()
    const sessionB = readCMS()
    expect(await sessionA.updateOffice("office-a", { name: "Published Name" })).toBe(true)
    const latest = structuredClone(boundary.server!.offices)
    const offices = latest.map((office) => Object.fromEntries(Object.entries(office).reverse())) as CMSData["offices"]
    boundary.local = sessionB.cmsData
    boundary.toast.mockClear()
    expect(await sessionB.saveCMSData({ ...sessionB.cmsData, offices })).toBe(true)
    expect(boundary.server!.offices).toEqual(latest)
    expect(boundary.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Content Saved" }))
  })

  it("seeds CMS sections only when the document does not exist", async () => {
    boundary.server = null
    expect(await readCMS().updateVenue("v1", { name: "Initial Venue" })).toBe(true)
    expect(boundary.server).toHaveProperty("offices")
    expect(boundary.server).toHaveProperty("homepage")
    expect(boundary.server).not.toHaveProperty("bookingCounter")
  })

  it.each(["add", "bulk", "update", "delete"])("returns failure without success feedback or local changes for room %s", async (operation) => {
    const cms = readCMS()
    const original = structuredClone(cms.cmsData)
    boundary.fail = true
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const save = operation === "add" ? cms.addRoomToOffice("office-a", { name: "Draft" })
        : operation === "bulk" ? cms.addRoomsToOffice("office-a", [{ name: "Draft 1" }, { name: "Draft 2" }])
          : operation === "update" ? cms.updateRoomInOffice("office-a", "office-a-room-1", { name: "Draft" })
            : cms.deleteRoomFromOffice("office-a", "office-a-room-1")
      expect(await save).toBe(false)
      expect(boundary.local).toEqual(original)
      expect(boundary.server).toEqual(original)
      expect(boundary.write).not.toHaveBeenCalled()
      expect(boundary.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ variant: "destructive" }))
    } finally {
      errorLog.mockRestore()
    }
  })
})
