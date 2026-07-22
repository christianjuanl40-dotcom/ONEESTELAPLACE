"use client"

import React, { createContext, useContext, useEffect, useState } from "react"
import { doc, onSnapshot, setDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { DEFAULT_POLICY_CONTENT, POLICY_LABELS, ALL_POLICY_KEYS, type PolicyKey } from "@/src/modules/shared/lib/policies"
import { setCachedPolicies } from "@/src/modules/shared/lib/policies"
import { setCachedVenuesAndOffices } from "@/src/modules/client/lib/venue-data"

export interface HomepageContent {
  heroTitle: string
  heroSubtitle: string
  heroImage: string
  heroDescription?: string
  heroBadge?: string
  heroPrimaryCta?: string
  heroSecondaryCta?: string
  aboutTitle?: string
  aboutDescription?: string
  aboutImage?: string
  aboutLabel?: string
  ctaText?: string
  ctaButtonText?: string
  ctaTitle?: string
  ctaDescription?: string
  ctaImage?: string
  galleryLabel?: string
  galleryTitle?: string
  gallerySubtitle?: string
  faqLabel?: string
  faqTitle?: string
  faqSubtitle?: string
}

export type ContractFile = {
  fileName: string
  fileType: string
  fileUrl: string
}

export type PastClientBooking = {
  id: string
  photos: string[]
  coverPhoto?: string
  name: string
  eventName: string
  eventType: string
  date: string
  testimonial: string
  companyName: string
  display: boolean
  createdAt: string
  updatedAt?: string
  isArchived?: boolean
  archivedAt?: string
}

export type FAQ = {
  id: string
  question: string
  answer: string
  isHidden?: boolean
  isArchived?: boolean
  archivedAt?: string
  order?: number
  createdAt: string
  updatedAt?: string
}

export type PolicyType = PolicyKey

export type Policy = {
  id: string
  title: string
  content: string
  type: PolicyType
  isPublished: boolean
  createdAt: string
  updatedAt?: string
}

export interface PaymentInfo {
  bankName: string
  accountName: string
  accountNumber: string
  instructions: string
  qrCodeUrl?: string
}

export interface OfficeRoom {
  id: string
  name: string
  isArchived?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CMSData {
  homepage: HomepageContent
  footer: {
    email: string
    phone: string
    address: string
    facebook: string
    brandName?: string
    footerDescription?: string
    copyrightText?: string
    instagram?: string
  }
  venues: any[]
  offices: any[]
  faqs: FAQ[]
  pastClientBookings: PastClientBooking[]
  policies: Policy[]
  eventVenueContract: ContractFile
  officeRentalContract: ContractFile
  paymentInfo: PaymentInfo
}

type CMSContextType = {
  cmsData: CMSData
  homepage: CMSData["homepage"]
  updateHomepage: (data: Partial<CMSData["homepage"]>) => void
  updateFooter: (data: Partial<CMSData["footer"]>) => void

  venues: CMSData["venues"]
  offices: CMSData["offices"]
  officeRoomsGround: any[]
  officeRoomsSecond: any[]
  updateVenue: (id: string, data: any) => void
  updateOffice: (id: string, data: any) => void
  addVenue: (data: any) => void
  deleteVenue: (id: string) => void
  addOffice: (data: any) => void
  deleteOffice: (id: string) => void
  updateOfficeRoom: (id: string, data: any) => void
  addOfficeRoom: (data: any) => void
  deleteOfficeRoom: (id: string) => void
  addRoomToOffice: (officeId: string, room: Omit<OfficeRoom, "id" | "createdAt">) => void
  addRoomsToOffice: (officeId: string, rooms: Omit<OfficeRoom, "id" | "createdAt">[]) => void
  updateRoomInOffice: (officeId: string, roomId: string, data: Partial<OfficeRoom>) => void
  deleteRoomFromOffice: (officeId: string, roomId: string) => void
  getOfficeRooms: (officeId: string) => OfficeRoom[]

  faqs: FAQ[]
  addFAQ: (data: Omit<FAQ, "id" | "createdAt" | "updatedAt">) => void
  updateFAQ: (id: string, data: Partial<FAQ>) => void
  deleteFAQ: (id: string) => void
  reorderFAQs: (orderedIds: string[]) => void

  policies: Policy[]
  addPolicy: (data: Omit<Policy, "id" | "createdAt" | "updatedAt">) => void
  updatePolicy: (id: string, data: Partial<Policy>) => void
  deletePolicy: (id: string) => void

  pastClientBookings: PastClientBooking[]
  addPastClientBooking: (data: Omit<PastClientBooking, "id" | "createdAt" | "updatedAt">) => void
  updatePastClientBooking: (id: string, data: Partial<PastClientBooking>) => void
  deletePastClientBooking: (id: string) => void

  saveCMSData: (newData: CMSData) => void
  updateEventVenueContract: (data: ContractFile) => void
  updateOfficeRentalContract: (data: ContractFile) => void
  paymentInfo: PaymentInfo
  updatePaymentInfo: (data: Partial<PaymentInfo>) => void
}

const CMS_DOC_PATH = "cms/data"

const DEFAULT_FAQS: FAQ[] = [
  {
    id: "faq-1",
    question: "How long is the standard venue rental?",
    answer:
      "The standard venue rental is 6 hours. Setup, program, and cleanup should fit within the approved booking schedule.",
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: "faq-2",
    question: "What is included in the venue rental?",
    answer:
      "One Estela Place focuses on venue space rental only. Clients may arrange their own decorations, catering, suppliers, and event services.",
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: "faq-3",
    question: "Do you provide catering services?",
    answer:
      "No. Catering is not included. Clients may bring or coordinate with their preferred caterer based on venue guidelines.",
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: "faq-4",
    question: "Can I visit the venue before booking?",
    answer:
      "Yes. Clients may schedule an ocular visit before finalizing their reservation.",
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: "faq-5",
    question: "How does booking confirmation work?",
    answer:
      "A booking request will be reviewed first. Once approved and payment requirements are verified, the booking may be marked as confirmed.",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
]

const DEFAULT_POLICIES: Policy[] = ALL_POLICY_KEYS.map((key, i) => ({
  id: `policy-${i + 1}`,
  title: POLICY_LABELS[key],
  content: DEFAULT_POLICY_CONTENT[key],
  type: key,
  isPublished: true,
  createdAt: new Date().toISOString(),
}))

const defaultPaymentInfo: PaymentInfo = {
  bankName: "BDO / GCash / Maya",
  accountName: "One Estela Place",
  accountNumber: "0012 3456 7890",
  instructions: "Please upload a clear screenshot of your bank transfer receipt.",
}

const defaultCMSData: CMSData = {
  homepage: {
    heroTitle: "Welcome to \nOne Estela Place",
    heroSubtitle:
      "The perfect venue for your special events, corporate gatherings, and everyday workspace needs.",
    heroImage: "/images/venue-interior.jpg",
    heroBadge: "Event Venue · San Pedro, Laguna",
    heroPrimaryCta: "Book Your Event",
    heroSecondaryCta: "Take a Tour",
    aboutTitle: "One Estela Place Event Venue",
    aboutDescription:
      "One Estela Place is an event venue in San Pedro, Laguna, established in 2018. It was created to provide a clean, comfortable, and elegant space for special occasions and gatherings.\n\nThe venue focuses on space rental, giving clients the freedom to arrange their own decorations, suppliers, catering, and event setup based on their preferred style.",
    aboutImage: "/images/venue-chandelier.png",
    aboutLabel: "Our Story",
    ctaTitle: "Ready to plan your next event?",
    ctaDescription:
      "Explore the venue through our virtual tour or send a booking request to start your reservation.",
    ctaButtonText: "Book Your Event",
    ctaText: "Take a Tour",
    galleryLabel: "Past Client Bookings",
    galleryTitle: "Real Events Hosted at One Estela Place",
    gallerySubtitle:
      "Actual client celebrations and gatherings held at our event venue, uploaded by the admin with client permission.",
    faqLabel: "Help Center",
    faqTitle: "Frequently Asked Questions",
    faqSubtitle:
      "Find answers to common questions about booking at One Estela Place.",
  },
  footer: {
    email: "inquiries@oneestelaplace.com",
    phone: "+63 917 123 4567",
    address: "Carmona, Calabarzon, Philippines",
    facebook: "https://facebook.com/oneestelaplace",
    brandName: "One Estela Place",
    footerDescription:
      "Creating unforgettable moments for your special events. The perfect place for weddings, birthdays, and corporate gatherings.",
    copyrightText: "One Estela Place. All rights reserved.",
    instagram: "#",
  },
  venues: [
    {
      id: "v1",
      name: "The Milestone Event",
      capacity: "80–100 pax",
      price: 15000,
      type: "venue",
      image: "/images/venue-chandelier.png",
      panoImage: "",
      description: "Premium space for grand celebrations and corporate events.",
    },
    {
      id: "v2",
      name: "The Moment Event",
      capacity: "30–50 pax",
      price: 10000,
      type: "venue",
      image: "/images/venue-interior.jpg",
      panoImage: "",
      description: "Intimate setting perfect for memorable milestones.",
    },
    {
      id: "v3",
      name: "Conference Room",
      capacity: "4–10 pax",
      price: 3000,
      type: "venue",
      image: "/images/venue-interior.jpg",
      panoImage: "",
      description: "Professional environment equipped for critical decisions.",
    },
    {
      id: "v4",
      name: "Business Room",
      capacity: "10–15 pax",
      price: 5000,
      type: "venue",
      image: "/images/venue-interior.jpg",
      panoImage: "",
      description: "Spacious meeting area ideal for collaborations.",
    },
  ],
  offices: [
    {
      id: "office-a",
      name: "Office A",
      capacity: "1-4 pax per room",
      price: 15000,
      type: "office",
      image: "/images/venue-interior.jpg",
      panoImage: "",
      description: "Premium office wing with 8 individual private rooms.",
      rooms: [
        { id: "office-a-room-1", name: "Room 1" },
        { id: "office-a-room-2", name: "Room 2" },
        { id: "office-a-room-3", name: "Room 3" },
        { id: "office-a-room-4", name: "Room 4" },
        { id: "office-a-room-5", name: "Room 5" },
        { id: "office-a-room-6", name: "Room 6" },
        { id: "office-a-room-7", name: "Room 7" },
        { id: "office-a-room-8", name: "Room 8" },
      ],
    },
    {
      id: "office-b",
      name: "Office B",
      capacity: "1-4 pax per room",
      price: 15000,
      type: "office",
      image: "/images/venue-interior.jpg",
      panoImage: "",
      description: "Executive office wing with 8 individual private rooms.",
      rooms: [
        { id: "office-b-room-1", name: "Room 1" },
        { id: "office-b-room-2", name: "Room 2" },
        { id: "office-b-room-3", name: "Room 3" },
        { id: "office-b-room-4", name: "Room 4" },
        { id: "office-b-room-5", name: "Room 5" },
        { id: "office-b-room-6", name: "Room 6" },
        { id: "office-b-room-7", name: "Room 7" },
        { id: "office-b-room-8", name: "Room 8" },
      ],
    },
  ],
  faqs: DEFAULT_FAQS,
  pastClientBookings: [],
  policies: DEFAULT_POLICIES,
  eventVenueContract: {
    fileName: "Events Place Contract.docx",
    fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileUrl: "/contracts/venue/Events Place Contract.docx",
  },
  officeRentalContract: {
    fileName: "Office space contract.docx",
    fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileUrl: "/contracts/office/Office space contract.docx",
  },
  paymentInfo: defaultPaymentInfo,
}

const defaultHomepage: CMSData["homepage"] = defaultCMSData.homepage

const defaultContextValue: CMSContextType = {
  cmsData: defaultCMSData,
  homepage: defaultHomepage,
  updateHomepage: () => {},
  updateFooter: () => {},

  venues: defaultCMSData.venues,
  offices: defaultCMSData.offices,
  officeRoomsGround: [],
  officeRoomsSecond: [],
  updateVenue: () => {},
  updateOffice: () => {},
  addVenue: () => {},
  deleteVenue: () => {},
  addOffice: () => {},
  deleteOffice: () => {},
  updateOfficeRoom: () => {},
  addOfficeRoom: () => {},
  deleteOfficeRoom: () => {},
  addRoomToOffice: () => {},
  addRoomsToOffice: () => {},
  updateRoomInOffice: () => {},
  deleteRoomFromOffice: () => {},
  getOfficeRooms: () => [],

  faqs: defaultCMSData.faqs,
  addFAQ: () => {},
  updateFAQ: () => {},
  deleteFAQ: () => {},
  reorderFAQs: () => {},

  policies: defaultCMSData.policies,
  addPolicy: () => {},
  updatePolicy: () => {},
  deletePolicy: () => {},

  pastClientBookings: [],
  addPastClientBooking: () => {},
  updatePastClientBooking: () => {},
  deletePastClientBooking: () => {},

  saveCMSData: () => {},
  updateEventVenueContract: () => {},
  updateOfficeRentalContract: () => {},
  paymentInfo: defaultPaymentInfo,
  updatePaymentInfo: () => {},
}

const CMSContext = createContext<CMSContextType>(defaultContextValue)

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizePastClientBooking(event: any): PastClientBooking {
  const photos = Array.isArray(event?.photos)
    ? event.photos.filter(Boolean)
    : event?.photo
      ? [event.photo]
      : []

  return {
    id: event?.id || createLocalId("past-client-booking"),
    photos: photos,
    coverPhoto: event?.coverPhoto || photos[0] || "",
    name: event?.name || "",
    eventName: event?.eventName || "",
    eventType: event?.eventType || "Event",
    date: event?.date || "",
    testimonial: event?.testimonial || "",
    companyName: event?.companyName || "",
    display: event?.display ?? true,
    createdAt: event?.createdAt || new Date().toISOString(),
    updatedAt: event?.updatedAt || event?.createdAt || new Date().toISOString(),
  }
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) result[key] = stripUndefined(val)
    }
    return result as T
  }
  return value
}

const BUILTIN_OFFICE_DEFAULT_ROOMS: Record<string, string[]> = {
  "office-a": ["Room 1", "Room 2", "Room 3", "Room 4", "Room 5", "Room 6", "Room 7", "Room 8"],
  "office-b": ["Room 1", "Room 2", "Room 3", "Room 4", "Room 5", "Room 6", "Room 7", "Room 8"],
}

function ensureBuiltinOfficeRooms(offices: any[]): any[] {
  return offices.map((office) => {
    if (!BUILTIN_OFFICE_DEFAULT_ROOMS[office.id]) return office
    if (Array.isArray(office.rooms) && office.rooms.length > 0) return office
    const defaultRoomNames = BUILTIN_OFFICE_DEFAULT_ROOMS[office.id]
    return {
      ...office,
      rooms: defaultRoomNames.map((name, i) => ({
        id: `${office.id}-room-${i + 1}`,
        name,
      })),
    }
  })
}

function normalizeCMSData(parsed: Partial<CMSData> | null): CMSData {
  if (!parsed) return defaultCMSData

  const parsedFaqs = Array.isArray(parsed.faqs) ? parsed.faqs : []

  const mergedFaqs =
    parsedFaqs.length >= DEFAULT_FAQS.length
      ? parsedFaqs
      : [
          ...parsedFaqs,
          ...DEFAULT_FAQS.filter(
            (defaultFaq) =>
              !parsedFaqs.some(
                (faq: any) =>
                  faq.id === defaultFaq.id ||
                  faq.question?.trim()?.toLowerCase() ===
                    defaultFaq.question.trim().toLowerCase()
              )
          ),
        ]

  return {
    ...defaultCMSData,
    ...parsed,
    homepage: {
      ...defaultCMSData.homepage,
      ...(parsed.homepage || {}),
    },
    footer: {
      ...defaultCMSData.footer,
      ...(parsed.footer || {}),
    },
    venues: Array.isArray(parsed.venues) ? parsed.venues : defaultCMSData.venues,
    offices: ensureBuiltinOfficeRooms(
      Array.isArray(parsed.offices) ? parsed.offices : defaultCMSData.offices
    ),
    faqs: mergedFaqs,
    pastClientBookings: Array.isArray(parsed.pastClientBookings)
      ? parsed.pastClientBookings.map(normalizePastClientBooking)
      : defaultCMSData.pastClientBookings,
    policies: Array.isArray(parsed.policies) ? parsed.policies : defaultCMSData.policies,
    eventVenueContract: parsed.eventVenueContract || defaultCMSData.eventVenueContract,
    officeRentalContract: parsed.officeRentalContract || defaultCMSData.officeRentalContract,
    paymentInfo: {
      ...defaultPaymentInfo,
      ...(parsed.paymentInfo || {}),
    },
  }
}

const cmsDocRef = doc(db, CMS_DOC_PATH)

export const CMSProvider = ({ children }: { children: React.ReactNode }) => {
  const [cmsData, setCmsData] = useState<CMSData>(defaultCMSData)
  const { toast } = useToast()

  useEffect(() => {
    const unsub = onSnapshot(
      cmsDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const parsed = docSnap.data() as CMSData
          const normalized = normalizeCMSData(parsed)
          setCmsData(normalized)
          try { setCachedPolicies(normalized.policies) } catch (e) { console.error("FAILED setCachedPolicies", e) }
          try { setCachedVenuesAndOffices(normalized.venues, normalized.offices) } catch (e) { console.error("FAILED setCachedVenuesAndOffices", e) }
        } else {
          setCmsData(defaultCMSData)
          setCachedPolicies(defaultCMSData.policies)
          setCachedVenuesAndOffices(defaultCMSData.venues, defaultCMSData.offices)
        }
      },
      (error) => {
        console.error("CMS SNAPSHOT ERROR", error)
        setCmsData(defaultCMSData)
      }
    )

    return () => unsub()
  }, [])

  const saveCMSData = async (newData: CMSData) => {
    const normalizedData = normalizeCMSData(newData)
    const dataToWrite = stripUndefined(normalizedData)

    console.log("[CMS DEBUG] collection:", cmsDocRef.path, "| docId:", cmsDocRef.id)
    console.log("[CMS DEBUG] payload keys:", Object.keys(dataToWrite))
    console.log(
      "[CMS DEBUG] pastClientBookings count:",
      Array.isArray(dataToWrite.pastClientBookings) ? dataToWrite.pastClientBookings.length : 0
    )

    try {
      await setDoc(cmsDocRef, dataToWrite)
      console.log("[CMS DEBUG] setDoc OK for", cmsDocRef.path)

      setCmsData(normalizedData)
      setCachedPolicies(normalizedData.policies)
      setCachedVenuesAndOffices(normalizedData.venues, normalizedData.offices)

      toast({
        title: "Content Saved",
        description: "Changes have been successfully published.",
        className: "bg-emerald-500 text-white border-none",
      })
    } catch (error) {
      console.error("[CMS DEBUG] setDoc FAILED:", error)
      toast({
        title: "Error",
        description: "Failed to save changes. Please try again.",
        variant: "destructive",
      })
    }
  }

  const updateHomepage = (data: Partial<CMSData["homepage"]>) => {
    saveCMSData({
      ...cmsData,
      homepage: {
        ...cmsData.homepage,
        ...data,
      },
    })
  }

  const updateFooter = (data: Partial<CMSData["footer"]>) => {
    saveCMSData({
      ...cmsData,
      footer: {
        ...cmsData.footer,
        ...data,
      },
    })
  }

  const updateVenue = (id: string, data: any) => {
    const updatedVenues = cmsData.venues.map((venue) =>
      venue.id === id
        ? {
            ...venue,
            ...data,
            updatedAt: new Date().toISOString(),
          }
        : venue
    )

    saveCMSData({
      ...cmsData,
      venues: updatedVenues,
    })
  }

  const updateOffice = (id: string, data: any) => {
    const updatedOffices = cmsData.offices.map((office) =>
      office.id === id
        ? {
            ...office,
            ...data,
            updatedAt: new Date().toISOString(),
          }
        : office
    )

    saveCMSData({
      ...cmsData,
      offices: updatedOffices,
    })
  }

  const addVenue = (data: any) => {
    const newVenue = {
      id: data.id || createLocalId("venue"),
      type: "venue",
      createdAt: new Date().toISOString(),
      ...data,
    }

    saveCMSData({
      ...cmsData,
      venues: [...cmsData.venues, newVenue],
    })
  }

  const deleteVenue = (id: string) => {
    saveCMSData({
      ...cmsData,
      venues: cmsData.venues.map((venue) =>
        venue.id === id
          ? { ...venue, isArchived: true, archivedAt: new Date().toISOString() }
          : venue
      ),
    })
  }

  const addOffice = (data: any) => {
    const newOffice = {
      id: data.id || createLocalId("office"),
      type: "office",
      createdAt: new Date().toISOString(),
      ...data,
    }

    saveCMSData({
      ...cmsData,
      offices: [...cmsData.offices, newOffice],
    })
  }

  const deleteOffice = (id: string) => {
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === id
          ? { ...office, isArchived: true, archivedAt: new Date().toISOString() }
          : office
      ),
    })
  }

  const addPastClientBooking = (
    data: Omit<PastClientBooking, "id" | "createdAt" | "updatedAt">
  ) => {
    const photos = Array.isArray(data.photos) ? data.photos : []
    const newBooking: PastClientBooking = {
      id: createLocalId("past-client-booking"),
      photos: photos,
      coverPhoto: data.coverPhoto || photos[0] || "",
      name: data.name,
      eventName: data.eventName,
      eventType: data.eventType,
      date: data.date,
      testimonial: data.testimonial,
      companyName: data.companyName,
      display: data.display ?? true,
      createdAt: new Date().toISOString(),
    }
    saveCMSData({
      ...cmsData,
      pastClientBookings: [newBooking, ...cmsData.pastClientBookings],
    })
  }

  const updatePastClientBooking = (id: string, data: Partial<PastClientBooking>) => {
    const updatedBookings = cmsData.pastClientBookings.map((booking) =>
      booking.id === id
        ? { ...booking, ...data, updatedAt: new Date().toISOString() }
        : booking
    )
    saveCMSData({
      ...cmsData,
      pastClientBookings: updatedBookings,
    })
  }

  const deletePastClientBooking = (id: string) => {
    saveCMSData({
      ...cmsData,
      pastClientBookings: cmsData.pastClientBookings.map((booking) =>
        booking.id === id
          ? { ...booking, isArchived: true, archivedAt: new Date().toISOString() }
          : booking
      ),
    })
  }

  const updateEventVenueContract = (data: ContractFile) => {
    saveCMSData({
      ...cmsData,
      eventVenueContract: data,
    })
  }

  const updatePaymentInfo = (data: Partial<PaymentInfo>) => {
    saveCMSData({
      ...cmsData,
      paymentInfo: {
        ...cmsData.paymentInfo,
        ...data,
      },
    })
  }

  const updateOfficeRentalContract = (data: ContractFile) => {
    saveCMSData({
      ...cmsData,
      officeRentalContract: data,
    })
  }

  const addFAQ = (
    data: Omit<FAQ, "id" | "createdAt" | "updatedAt">
  ) => {
    const newFAQ: FAQ = {
      id: createLocalId("faq"),
      question: data.question,
      answer: data.answer,
      isHidden: data.isHidden ?? false,
      order: data.order ?? cmsData.faqs.length,
      createdAt: new Date().toISOString(),
    }
    saveCMSData({
      ...cmsData,
      faqs: [...cmsData.faqs, newFAQ],
    })
  }

  const updateFAQ = (id: string, data: Partial<FAQ>) => {
    saveCMSData({
      ...cmsData,
      faqs: cmsData.faqs.map((faq) =>
        faq.id === id ? { ...faq, ...data, updatedAt: new Date().toISOString() } : faq
      ),
    })
  }

  const deleteFAQ = (id: string) => {
    saveCMSData({
      ...cmsData,
      faqs: cmsData.faqs.map((faq) =>
        faq.id === id
          ? { ...faq, isArchived: true, archivedAt: new Date().toISOString() }
          : faq
      ),
    })
  }

  const reorderFAQs = (orderedIds: string[]) => {
    const reordered = orderedIds
      .map((id, index) => {
        const faq = cmsData.faqs.find((f) => f.id === id)
        return faq ? { ...faq, order: index } : null
      })
      .filter(Boolean) as FAQ[]
    saveCMSData({
      ...cmsData,
      faqs: reordered,
    })
  }

  const addPolicy = (
    data: Omit<Policy, "id" | "createdAt" | "updatedAt">
  ) => {
    const newPolicy: Policy = {
      id: createLocalId("policy"),
      title: data.title,
      content: data.content,
      type: data.type,
      isPublished: data.isPublished ?? true,
      createdAt: new Date().toISOString(),
    }
    saveCMSData({
      ...cmsData,
      policies: [...cmsData.policies, newPolicy],
    })
  }

  const updatePolicy = (id: string, data: Partial<Policy>) => {
    saveCMSData({
      ...cmsData,
      policies: cmsData.policies.map((policy) =>
        policy.id === id ? { ...policy, ...data, updatedAt: new Date().toISOString() } : policy
      ),
    })
  }

  const deletePolicy = (id: string) => {
    saveCMSData({
      ...cmsData,
      policies: cmsData.policies.map((policy) =>
        policy.id === id
          ? { ...policy, isArchived: true, archivedAt: new Date().toISOString() }
          : policy
      ),
    })
  }

  const updateOfficeRoom: CMSContextType["updateOfficeRoom"] = (id, data) => {
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === id
          ? {
              ...office,
              ...data,
              updatedAt: new Date().toISOString(),
            }
          : office
      ),
    })
  }

  const addOfficeRoom: CMSContextType["addOfficeRoom"] = (data) => {
    const newRoom = {
      id: data.id || createLocalId("office-room"),
      ...data,
      createdAt: new Date().toISOString(),
    }
    saveCMSData({
      ...cmsData,
      offices: [...cmsData.offices, newRoom],
    })
  }

  const deleteOfficeRoom: CMSContextType["deleteOfficeRoom"] = (id) => {
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === id
          ? { ...office, isArchived: true, archivedAt: new Date().toISOString() }
          : office
      ),
    })
  }

  const addRoomToOffice: CMSContextType["addRoomToOffice"] = (officeId, room) => {
    const newRoom: OfficeRoom = {
      id: `${officeId}-room-${Date.now()}`,
      ...room,
      createdAt: new Date().toISOString(),
    }
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === officeId
          ? {
              ...office,
              rooms: [...(office.rooms || []), newRoom],
              updatedAt: new Date().toISOString(),
            }
          : office
      ),
    })
  }

  const addRoomsToOffice: CMSContextType["addRoomsToOffice"] = (officeId, roomsData) => {
    const newRooms: OfficeRoom[] = roomsData.map((room, i) => ({
      id: `${officeId}-room-${Date.now()}-${i}`,
      ...room,
      createdAt: new Date().toISOString(),
    }))
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === officeId
          ? {
              ...office,
              rooms: [...(office.rooms || []), ...newRooms],
              updatedAt: new Date().toISOString(),
            }
          : office
      ),
    })
  }

  const updateRoomInOffice: CMSContextType["updateRoomInOffice"] = (officeId, roomId, data) => {
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === officeId
          ? {
              ...office,
              rooms: (office.rooms || []).map((room: OfficeRoom) =>
                room.id === roomId
                  ? { ...room, ...data, updatedAt: new Date().toISOString() }
                  : room
              ),
              updatedAt: new Date().toISOString(),
            }
          : office
      ),
    })
  }

  const deleteRoomFromOffice: CMSContextType["deleteRoomFromOffice"] = (officeId, roomId) => {
    saveCMSData({
      ...cmsData,
      offices: cmsData.offices.map((office) =>
        office.id === officeId
          ? {
              ...office,
              rooms: (office.rooms || []).filter((room: OfficeRoom) => room.id !== roomId),
              updatedAt: new Date().toISOString(),
            }
          : office
      ),
    })
  }

  const getOfficeRooms: CMSContextType["getOfficeRooms"] = (officeId) => {
    const office = cmsData.offices.find((o) => o.id === officeId)
    return (office?.rooms || []).filter((r: OfficeRoom) => !r.isArchived)
  }

  return (
    <CMSContext.Provider
      value={{
        cmsData,
        homepage: cmsData.homepage,
        updateHomepage,
        updateFooter,

        venues: cmsData.venues,
        offices: cmsData.offices,
        officeRoomsGround: cmsData.offices.filter((office: any) => office?.floor === "ground" || office?.floor === "Ground"),
        officeRoomsSecond: cmsData.offices.filter((office: any) => office?.floor === "second" || office?.floor === "Second"),
        updateVenue,
        updateOffice,
        addVenue,
        deleteVenue,
        addOffice,
        deleteOffice,
        updateOfficeRoom,
        addOfficeRoom,
        deleteOfficeRoom,
        addRoomToOffice,
        addRoomsToOffice,
        updateRoomInOffice,
        deleteRoomFromOffice,
        getOfficeRooms,

        faqs: cmsData.faqs,
        addFAQ,
        updateFAQ,
        deleteFAQ,
        reorderFAQs,

        policies: cmsData.policies,
        addPolicy,
        updatePolicy,
        deletePolicy,

        pastClientBookings: cmsData.pastClientBookings,
        addPastClientBooking,
        updatePastClientBooking,
        deletePastClientBooking,

        saveCMSData,
        updateEventVenueContract,
        updateOfficeRentalContract,
        paymentInfo: cmsData.paymentInfo,
        updatePaymentInfo,
      }}
    >
      {children}
    </CMSContext.Provider>
  )
}

export const useCMS = () => useContext(CMSContext)