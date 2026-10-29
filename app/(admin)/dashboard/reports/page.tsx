"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  CalendarDays,
  Download,
  Filter,
  PieChart as PieChartIcon,
  Printer,
  Search,
  TrendingUp,
} from "lucide-react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/modules/shared/components/ui/select"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useBookingData } from "@/src/modules/client/contexts/booking-context"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { getBookingTotal } from "@/src/modules/shared/lib/payment-calculations"
import {
  buildReportSummary,
  calculateReportBookingFinancials,
  type ReportBookingFinancials,
  type ReportBookingLike,
} from "@/src/modules/shared/lib/report-calculations"
import { getBookingLifecycleLabel as getCanonicalBookingLifecycleLabel } from "@/src/modules/shared/lib/booking-helpers"
import {
  isOfficeResourceBooking,
  resolveResourceSpace,
  type ResourceResolution,
} from "@/src/modules/shared/lib/resource-identity"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Legend,
  Line,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type BookingRecord = {
  id?: string | number
  bookingCode?: string
  eventName?: string
  eventType?: string
  bookingCategory?: string
  bookingType?: string
  rentalType?: string
  isOfficeRental?: boolean
  customerName?: string
  clientName?: string
  name?: string
  date?: string
  eventDate?: string
  createdAt?: string
  venue?: string
  venueId?: string
  officeId?: string
  spaceId?: string
  roomId?: string
  roomName?: string
  officeName?: string
  officeRoom?: string
  officeSpaceName?: string
  natureOfBusiness?: string
  status?: string
  paymentStatus?: string
  totalPrice?: number | string
  totalAmount?: number | string
  amount?: number | string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const STATUS_GROUPS = [
  { name: "Confirmed", color: "#10B981", statuses: ["confirmed"] },
  { name: "Pending", color: "#F59E0B", statuses: ["pending"] },
  { name: "Completed", color: "#3B82F6", statuses: ["completed"] },
  { name: "Cancelled", color: "#EF4444", statuses: ["cancelled"] },
] as const

const OTHER_STATUS_GROUP = { name: "Other", color: "#94a3b8" }

function getStatusGroupName(status?: string) {
  const normalized = normalizeStatus(status)
  return (
    STATUS_GROUPS.find((group) => (group.statuses as readonly string[]).includes(normalized))?.name ??
    OTHER_STATUS_GROUP.name
  )
}

function getStatusGroupColor(groupName: string) {
  return STATUS_GROUPS.find((group) => group.name === groupName)?.color ?? OTHER_STATUS_GROUP.color
}

const CONFIRMED_STATUSES = ["confirmed"]
const PENDING_STATUSES = ["pending", "verifying", "pencil booking", "for review", "for verification", "awaiting payment"]
const CANCELLED_STATUSES = ["cancelled", "canceled", "declined", "rejected"]

function normalizeStatus(status?: string) {
  return String(status || "pending").trim().toLowerCase()
}

function prettifyStatus(status?: string) {
  return normalizeStatus(status)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function getBookingDate(booking: BookingRecord) {
  return booking.date || booking.eventDate || booking.createdAt || ""
}

function parseBookingDate(booking: BookingRecord) {
  const rawDate = getBookingDate(booking)
  const parsed = rawDate ? new Date(rawDate) : null

  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return parsed
}

function getBookingAmount(booking: BookingRecord) {
  return getBookingTotal(booking as ReportBookingLike)
}

function formatMoney(value: number) {
  return `₱${Number(value || 0).toLocaleString("en-PH")}`
}

function formatReportMoney(value: number) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function abbreviateMoney(value: number) {
  if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `₱${Math.round(value / 1_000)}k`
  return `₱${value}`
}

function getVenueName(venue?: string) {
  if (!venue) return "Unassigned"
  return venue.split(" - ")[0]?.trim() || venue
}

function getEventType(booking: BookingRecord) {
  return booking.eventType || booking.eventName || "Unspecified"
}

type ReportBookingCategory = "venue" | "office" | null
type ReportCategoryFilter = "all" | "venue" | "office"

type ReportResourceOption = {
  category: "venue" | "office"
  id: string
  name: string
  rooms?: Array<{
    id: string
    name: string
    isArchived?: boolean
    isHidden?: boolean
    isBookable?: boolean
  }>
}

type ClassifiedBooking = {
  booking: BookingRecord
  category: ReportBookingCategory
  resolution: ResourceResolution
}

function normalizeCategoryMetadata(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
}

/**
 * Only controlled booking metadata is considered here. Display names and
 * customer-entered event fields are intentionally not category signals.
 */
function getExplicitReportBookingCategory(booking: BookingRecord): ReportBookingCategory {
  if (isOfficeResourceBooking(booking)) return "office"

  for (const value of [booking.bookingCategory, booking.bookingType, booking.rentalType]) {
    const normalized = normalizeCategoryMetadata(value)
    if (["venue", "event", "event_venue", "event_venue_rental", "event_venue_booking", "event_booking"].includes(normalized)) {
      return "venue"
    }
  }

  return booking.isOfficeRental === false ? "venue" : null
}

function getReportBookingCategory(
  booking: BookingRecord,
  resolution: ResourceResolution,
): ReportBookingCategory {
  const explicitCategory = getExplicitReportBookingCategory(booking)
  if (explicitCategory) return explicitCategory

  if (resolution.status === "resolved") return resolution.space.category

  // An ambiguous resource can still have a reliable broad category when all
  // candidates belong to the same catalog section. It is not assigned to any
  // particular venue, office, or room in that case.
  const candidateCategories = new Set(resolution.candidates.map((candidate) => candidate.category))
  return candidateCategories.size === 1 ? [...candidateCategories][0] : null
}

function getResourceFilterValue(category: "venue" | "office", id: string) {
  return `${category}:${id}`
}

function getResourceFilterValueForSpace(space: {
  category: "venue" | "office"
  venueId: string
  officeId?: string
}) {
  return getResourceFilterValue(
    space.category,
    space.category === "office" ? space.officeId || space.venueId : space.venueId,
  )
}

function parseResourceFilterValue(value: string) {
  if (value === "all") return null
  const separator = value.indexOf(":")
  if (separator <= 0 || separator === value.length - 1) return null
  const category = value.slice(0, separator)
  if (category !== "venue" && category !== "office") return null
  return { category, id: value.slice(separator + 1) } as const
}

function isActiveCatalogEntry(entry: { id?: unknown; isArchived?: boolean }) {
  return Boolean(String(entry.id || "").trim()) && entry.isArchived !== true
}

const EXCEL_HEADERS = [
  "Booking ID",
  "Event Name",
  "Client",
  "Date",
  "Venue",
  "Booking Status",
  "Payment Status",
  "Total Amount",
  "Remaining Balance",
  "Refund Status",
  "Refund Amount",
]

type EnrichedBooking = BookingRecord & {
  _category: ReportBookingCategory
  _financials: ReportBookingFinancials
}

type ReportRow = {
  bookingId: string | number
  eventName: string
  client: string
  date: Date | string
  venue: string
  bookingStatus: string
  paymentStatus: string
  totalAmount: number
  remainingBalance: number
  refundStatus: string
  refundAmount: number
}

function getReportLifecycleLabel(booking: BookingRecord) {
  return getCanonicalBookingLifecycleLabel(booking as ReportBookingLike)
}

function getReportClientName(booking: BookingRecord) {
  const b = booking as any
  const name =
    b.userInfo?.name ||
    booking.customerName ||
    booking.clientName ||
    booking.name ||
    b.customerName ||
    b.clientName ||
    b.name ||
    ""
  return name.trim() || "N/A"
}

function getReportDateCell(booking: BookingRecord) {
  const parsedDate = parseBookingDate(booking)
  const dateCell = parsedDate ? new Date(parsedDate.getTime()) : getBookingDate(booking) || "No date"

  if (dateCell instanceof Date) dateCell.setHours(12, 0, 0, 0)
  return dateCell
}

function formatReportDate(value: Date | string) {
  if (!(value instanceof Date)) return value || "No date"

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(value)
}

function formatDate(booking: BookingRecord) {
  const parsed = parseBookingDate(booking)

  if (!parsed) return getBookingDate(booking) || "No date"

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function formatGeneratedDate(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)
}

function formatGeneratedTime(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function buildReportRows(bookings: EnrichedBooking[]): ReportRow[] {
  return bookings.map((booking) => {
    const financials = booking._financials

    return {
      bookingId: booking.id || "N/A",
      eventName: booking.eventName || booking.eventType || "Untitled Event",
      client: getReportClientName(booking),
      date: getReportDateCell(booking),
      venue: booking.venue || "N/A",
      bookingStatus: getCanonicalBookingLifecycleLabel(booking as ReportBookingLike),
      paymentStatus: financials.paymentStatus,
      totalAmount: financials.totalAmount,
      remainingBalance: financials.remainingBalance,
      refundStatus: financials.refundStatus,
      refundAmount: financials.refundAmount,
    }
  })
}

async function loadLogoBase64(url: string) {
  const response = await fetch(url)
  if (!response.ok) return ""
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || "")
      resolve(dataUrl.split(",")[1] || "")
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const PESO_NUMBER_FORMAT = '"₱"#,##0.00'
const DATE_NUMBER_FORMAT = "mmm dd, yyyy"

const EXCEL_THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFCBD5E1" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
} as const

function columnLetter(index: number) {
  let letter = ""
  let current = index

  while (current > 0) {
    const remainder = (current - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    current = Math.floor((current - 1) / 26)
  }

  return letter
}

function computeColumnWidths(headers: string[], rows: (string | number | Date)[][]) {
  const widths = headers.map((header) => Math.max(header.length + 3, 9))

  rows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      const length = cell instanceof Date ? 12 : String(cell ?? "").length
      widths[columnIndex] = Math.min(Math.max(widths[columnIndex], length + 2), 42)
    })
  })

  return widths
}

function getStatusBadgeClass(status?: string) {
  const normalized = normalizeStatus(status)

  if (CONFIRMED_STATUSES.includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (PENDING_STATUSES.includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  if (CANCELLED_STATUSES.includes(normalized)) {
    return "border-rose-200 bg-rose-50 text-rose-700"
  }

  return "border-slate-200 bg-slate-50 text-slate-700"
}

function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => setWidth(element.getBoundingClientRect().width)
    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

type MonthlyPerformancePoint = {
  month: string
  revenue: number
  bookings: number
}

type RevenueByVenuePoint = {
  name: string
  total: number
}

type ReportCountPoint = {
  name: string
  value: number
}

type ReportChartProps = {
  isPrinting: boolean
  printOnly?: boolean
}

function ReportMonthlyPerformanceChart({
  data,
  isPrinting,
  printOnly = false,
}: ReportChartProps & { data: MonthlyPerformancePoint[] }) {
  return (
    <ResponsiveContainer
      initialDimension={printOnly ? { width: 1000, height: 210 } : undefined}
      width={isPrinting ? 1000 : "100%"}
      height={isPrinting ? 210 : "100%"}
    >
      <ComposedChart data={data} margin={{ top: isPrinting ? 18 : 10, right: isPrinting ? 18 : 10, left: isPrinting ? 18 : -18, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
          dy={10}
        />
        <YAxis
          yAxisId="left"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
          tickFormatter={(value) => abbreviateMoney(Number(value))}
        >
          {isPrinting && <Label value="Revenue (PHP)" angle={-90} position="insideLeft" fill="#64748b" fontSize={9} fontWeight={700} />}
        </YAxis>
        <YAxis
          yAxisId="right"
          orientation="right"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
        >
          {isPrinting && <Label value="Bookings" angle={90} position="insideRight" fill="#64748b" fontSize={9} fontWeight={700} />}
        </YAxis>
        <Tooltip
          formatter={(value, name) => {
            if (name === "revenue") return [formatMoney(Number(value)), "Revenue"]
            return [`${value} booking/s`, "Bookings"]
          }}
          contentStyle={{
            borderRadius: "1rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 10px 25px -15px rgb(15 23 42 / 0.35)",
            fontWeight: 700,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />
        <Bar
          yAxisId="left"
          dataKey="revenue"
          fill="#ea580c"
          radius={[8, 8, 0, 0]}
          name="Revenue"
          isAnimationActive={!isPrinting}
        >
          {isPrinting && (
            <LabelList
              dataKey="revenue"
              position="top"
              fill="#c2410c"
              fontSize={9}
              fontWeight={700}
              formatter={(value: unknown) => {
                const amount = Number(value)
                return amount > 0 ? abbreviateMoney(amount) : ""
              }}
            />
          )}
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="bookings"
          stroke="#0f172a"
          strokeWidth={3}
          dot={{ r: 4 }}
          name="Bookings"
          isAnimationActive={!isPrinting}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function ReportRevenueByVenueChart({
  data,
  isPrinting,
  printOnly = false,
}: ReportChartProps & { data: RevenueByVenuePoint[] }) {
  return (
    <ResponsiveContainer
      initialDimension={printOnly ? { width: 480, height: 190 } : undefined}
      width={isPrinting ? 480 : "100%"}
      height={isPrinting ? 190 : "100%"}
    >
      <BarChart data={data} margin={{ top: isPrinting ? 18 : 5, right: 10, left: isPrinting ? 18 : -18, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
          dy={10}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
          tickFormatter={(value) => abbreviateMoney(Number(value))}
        >
          {isPrinting && <Label value="Revenue (PHP)" angle={-90} position="insideLeft" fill="#64748b" fontSize={9} fontWeight={700} />}
        </YAxis>
        <Tooltip
          cursor={{ fill: "#f8fafc" }}
          formatter={(value) => [formatMoney(Number(value)), "Revenue"]}
          contentStyle={{
            borderRadius: "1rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 10px 25px -15px rgb(15 23 42 / 0.35)",
            fontWeight: 700,
          }}
        />
        {isPrinting && <Legend wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />}
        <Bar
          dataKey="total"
          fill="#ea580c"
          radius={[8, 8, 0, 0]}
          barSize={42}
          name="Revenue"
          isAnimationActive={!isPrinting}
        >
          {isPrinting && (
            <LabelList
              dataKey="total"
              position="top"
              fill="#c2410c"
              fontSize={9}
              fontWeight={700}
              formatter={(value: unknown) => abbreviateMoney(Number(value))}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function ReportStatusPieChart({
  data,
  isPrinting,
  printOnly = false,
}: ReportChartProps & { data: ReportCountPoint[] }) {
  return (
    <ResponsiveContainer
      initialDimension={printOnly ? { width: 160, height: 160 } : undefined}
      width={isPrinting ? 160 : "100%"}
      height={isPrinting ? 160 : "100%"}
    >
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="56%"
          outerRadius="80%"
          paddingAngle={3}
          dataKey="value"
          stroke="none"
          isAnimationActive={!isPrinting}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={getStatusGroupColor(entry.name)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [`${value} booking/s`, "Total"]}
          contentStyle={{
            borderRadius: "1rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 10px 25px -15px rgb(15 23 42 / 0.35)",
            fontWeight: 700,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

function ReportEventTypeChart({
  data,
  isPrinting,
  printOnly = false,
}: ReportChartProps & { data: ReportCountPoint[] }) {
  return (
    <ResponsiveContainer
      initialDimension={printOnly ? { width: 1000, height: 210 } : undefined}
      width={isPrinting ? 1000 : "100%"}
      height={isPrinting ? 210 : "100%"}
    >
      <BarChart data={data} margin={{ top: isPrinting ? 18 : 5, right: 10, left: isPrinting ? 18 : -18, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
          dy={10}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
        >
          {isPrinting && <Label value="Bookings" angle={-90} position="insideLeft" fill="#64748b" fontSize={9} fontWeight={700} />}
        </YAxis>
        <Tooltip
          cursor={{ fill: "#f8fafc" }}
          formatter={(value) => [`${value} booking/s`, "Total"]}
          contentStyle={{
            borderRadius: "1rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 10px 25px -15px rgb(15 23 42 / 0.35)",
            fontWeight: 700,
          }}
        />
        {isPrinting && <Legend wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />}
        <Bar
          dataKey="value"
          fill="#0f172a"
          radius={[8, 8, 0, 0]}
          barSize={42}
          name="Bookings"
          isAnimationActive={!isPrinting}
        >
          {isPrinting && (
            <LabelList
              dataKey="value"
              position="top"
              fill="#0f172a"
              fontSize={9}
              fontWeight={700}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function ReportsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const { bookings = [], paymentRecords = [], isLoading: bookingsLoading } = useBookingData({ bookings: true, payments: true })
  const { cmsData } = useCMS()
  const { ref: statusCardRef, width: statusCardWidth } = useContainerWidth<HTMLDivElement>()
  const isWideLayout = statusCardWidth >= 700

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.reports) {
      router.replace("/dashboard")
    }
  }, [user, router])

  const [filterYear, setFilterYear] = useState("all")
  const [filterMonth, setFilterMonth] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterCategory, setFilterCategory] = useState<ReportCategoryFilter>("all")
  const [filterResource, setFilterResource] = useState("all")
  const [filterRoom, setFilterRoom] = useState("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [printDate, setPrintDate] = useState<Date | null>(null)
  const isPrinting = printDate !== null
  const generatedBy = user?.fullName || user?.name || user?.email || "System User"

  useEffect(() => {
    // Commit print dimensions and all filtered rows before the browser snapshots
    // the page; ResizeObserver alone can update responsive charts too late.
    const beforePrint = () => flushSync(() => setPrintDate(new Date()))
    const afterPrint = () => setPrintDate(null)
    const printMedia = window.matchMedia("print")
    const onPrintMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) beforePrint()
      else afterPrint()
    }

    window.addEventListener("beforeprint", beforePrint)
    window.addEventListener("afterprint", afterPrint)
    printMedia.addEventListener("change", onPrintMediaChange)
    return () => {
      window.removeEventListener("beforeprint", beforePrint)
      window.removeEventListener("afterprint", afterPrint)
      printMedia.removeEventListener("change", onPrintMediaChange)
    }
  }, [])

  const bookingList = useMemo(() => {
    return Array.isArray(bookings) ? (bookings as BookingRecord[]) : []
  }, [bookings])

  const eventVenueOptions = useMemo<ReportResourceOption[]>(() => {
    return cmsData.venues
      .filter(isActiveCatalogEntry)
      .map((venue) => ({
        category: "venue",
        id: String(venue.id),
        name: String(venue.name || venue.id),
      }))
  }, [cmsData.venues])

  const officeOptions = useMemo<ReportResourceOption[]>(() => {
    return cmsData.offices
      .filter(isActiveCatalogEntry)
      .map((office) => ({
        category: "office",
        id: String(office.id),
        name: String(office.name || office.id),
        rooms: Array.isArray(office.rooms)
          ? office.rooms
            .filter((room: any) => (
              Boolean(String(room?.id || "").trim())
              && room?.isArchived !== true
              && room?.isHidden !== true
              && room?.isBookable !== false
            ))
            .map((room: any) => ({
              id: String(room.id),
              name: String(room.name || room.id),
              isArchived: room.isArchived,
              isHidden: room.isHidden,
              isBookable: room.isBookable,
            }))
          : [],
      }))
  }, [cmsData.offices])

  const resourceOptions = useMemo(() => {
    if (filterCategory === "venue") return eventVenueOptions
    if (filterCategory === "office") return officeOptions
    return [...eventVenueOptions, ...officeOptions]
  }, [eventVenueOptions, filterCategory, officeOptions])

  const selectedResourceOption = useMemo(() => {
    if (filterResource === "all") return null
    return resourceOptions.find(
      (resource) => getResourceFilterValue(resource.category, resource.id) === filterResource,
    ) || null
  }, [filterResource, resourceOptions])

  // A resource can disappear from a live CMS snapshot after it was selected.
  // Treat that stale value as "all" until the user chooses a current option;
  // category/resource handlers still reset the actual state immediately.
  const effectiveFilterResource = selectedResourceOption ? filterResource : "all"

  const roomOptions = useMemo(() => {
    if (selectedResourceOption?.category !== "office") return []
    return selectedResourceOption.rooms || []
  }, [selectedResourceOption])

  const effectiveFilterRoom = roomOptions.some((room) => room.id === filterRoom) ? filterRoom : "all"

  const classifiedBookings = useMemo<ClassifiedBooking[]>(() => {
    return bookingList.map((booking) => {
      const resolution = resolveResourceSpace(
        cmsData,
        booking as unknown as Record<string, unknown>,
      )
      return {
        booking,
        category: getReportBookingCategory(booking, resolution),
        resolution,
      }
    })
  }, [bookingList, cmsData])

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>()

    bookingList.forEach((booking) => {
      statuses.add(getReportLifecycleLabel(booking).toLowerCase())
    })

    return ["all", ...Array.from(statuses).filter(Boolean).sort()]
  }, [bookingList])

  const yearOptions = useMemo(() => {
    const years = new Set<string>()

    bookingList.forEach((booking) => {
      const parsedDate = parseBookingDate(booking)
      if (parsedDate) years.add(parsedDate.getFullYear().toString())
    })

    const sorted = Array.from(years).sort((a, b) => Number(b) - Number(a))
    if (filterYear !== "all" && !sorted.includes(filterYear)) sorted.push(filterYear)
    return sorted
  }, [bookingList, filterYear])

  const filteredEntries = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()
    const selectedResource = parseResourceFilterValue(effectiveFilterResource)

    return classifiedBookings
      .filter((entry) => {
        const booking = entry.booking
        const parsedDate = parseBookingDate(booking)
        const bookingStatus = getReportLifecycleLabel(booking).toLowerCase()
        const bookingYear = parsedDate ? parsedDate.getFullYear().toString() : ""

        const matchesMonth =
          filterMonth === "all" || (parsedDate && parsedDate.getMonth().toString() === filterMonth)

        const matchesYear = filterYear === "all" || bookingYear === filterYear

        const matchesStatus = filterStatus === "all" || bookingStatus === filterStatus

        const matchesCategory = filterCategory === "all" || entry.category === filterCategory
        const matchesResource = effectiveFilterResource === "all"
          ? true
          : Boolean(
            selectedResource
            && entry.resolution.status === "resolved"
            && getResourceFilterValueForSpace(entry.resolution.space) === effectiveFilterResource
            && entry.resolution.space.category === selectedResource.category
            && (
              selectedResource.category === "venue"
                ? entry.resolution.space.venueId === selectedResource.id
                : (entry.resolution.space.officeId || entry.resolution.space.venueId) === selectedResource.id
            ),
          )

        const matchesRoom = effectiveFilterRoom === "all"
          ? true
          : Boolean(
            selectedResource?.category === "office"
            && entry.resolution.status === "resolved"
            && entry.resolution.space.category === "office"
            && (entry.resolution.space.officeId || entry.resolution.space.venueId) === selectedResource.id
            && entry.resolution.space.spaceId === effectiveFilterRoom
            && entry.resolution.space.spaceId !== entry.resolution.space.venueId,
          )

        const searchableText = [
          booking.id,
          booking.bookingCode,
          booking.eventName,
          booking.eventType,
          booking.customerName,
          booking.clientName,
          booking.name,
          booking.venue,
          booking.status,
          booking.paymentStatus,
          getBookingDate(booking),
          booking.bookingCategory,
          booking.bookingType,
          booking.venueId,
          booking.officeId,
          booking.spaceId,
          booking.roomId,
          booking.roomName,
          booking.officeName,
          booking.officeRoom,
          booking.officeSpaceName,
        ]
          .join(" ")
          .toLowerCase()

        const matchesSearch = !keyword || searchableText.includes(keyword)

        return matchesCategory
          && matchesResource
          && matchesRoom
          && matchesYear
          && matchesMonth
          && matchesStatus
          && matchesSearch
      })
      .sort((a, b) => {
        const dateA = parseBookingDate(a.booking)?.getTime() || 0
        const dateB = parseBookingDate(b.booking)?.getTime() || 0
        return dateB - dateA
      })
  }, [classifiedBookings, effectiveFilterResource, effectiveFilterRoom, filterCategory, filterYear, filterMonth, filterStatus, searchTerm])

  // Every report surface below consumes this same filtered booking collection.
  const filteredData = useMemo(
    () => filteredEntries.map((entry) => entry.booking),
    [filteredEntries],
  )

  const enrichedData = useMemo(() => {
    const records = Array.isArray(paymentRecords) ? paymentRecords : []
    return filteredEntries.map((entry) => {
      const financials = calculateReportBookingFinancials(entry.booking as ReportBookingLike, records)
      return { ...entry.booking, _category: entry.category, _financials: financials }
    })
  }, [filteredEntries, paymentRecords])

  const reportRows = useMemo(() => buildReportRows(enrichedData), [enrichedData])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedData = useMemo(
    () => enrichedData.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage),
    [enrichedData, safePage, rowsPerPage],
  )

  const reportSummary = useMemo(
    () => buildReportSummary(
      enrichedData.map((booking) => ({
        booking: booking as ReportBookingLike,
        financials: booking._financials,
      })),
    ),
    [enrichedData],
  )
  const totalRevenue = reportSummary.totalRevenue
  const totalRefunds = reportSummary.totalRefunds

  const netRevenue = useMemo(() => {
    return totalRevenue - totalRefunds
  }, [totalRevenue, totalRefunds])

  const monthlyPerformance = useMemo(() => {
    const map = MONTHS.map((month) => ({
      month,
      revenue: 0,
      bookings: 0,
    }))

    enrichedData.forEach((booking) => {
      const parsedDate = parseBookingDate(booking)
      if (!parsedDate) return

      const monthIndex = parsedDate.getMonth()
      map[monthIndex].bookings += 1

      map[monthIndex].revenue += booking._financials.receivedAmount
    })

    return filterMonth === "all" ? map : map.filter((_, index) => index.toString() === filterMonth)
  }, [enrichedData, filterMonth])

  const revenueByVenue = useMemo(() => {
    const map: Record<string, number> = {}

    enrichedData.forEach((booking) => {
      const venue = getVenueName(booking.venue)
      map[venue] = (map[venue] || 0) + booking._financials.receivedAmount
    })

    return Object.entries(map)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
  }, [enrichedData])

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {}

    filteredData.forEach((booking) => {
       const group = getStatusGroupName(getReportLifecycleLabel(booking))
      map[group] = (map[group] || 0) + 1
    })

    const counts: { name: string; value: number }[] = STATUS_GROUPS.filter((group) => map[group.name]).map(
      (group) => ({
        name: group.name,
        value: map[group.name],
      }),
    )

    if (map[OTHER_STATUS_GROUP.name]) {
      counts.push({ name: OTHER_STATUS_GROUP.name, value: map[OTHER_STATUS_GROUP.name] })
    }

    return counts
  }, [filteredData])

  const eventTypeCounts = useMemo(() => {
    const map: Record<string, number> = {}

    enrichedData.forEach((booking) => {
      // Office business-nature values are not event types. The existing chart
      // remains useful for venue bookings and stays empty for office-only data.
      if (booking._category !== "venue") return
      const eventType = getEventType(booking)
      map[eventType] = (map[eventType] || 0) + 1
    })

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [enrichedData])

  const reportPeriod =
    filterYear !== "all" && filterMonth !== "all"
      ? `${MONTHS[Number(filterMonth)]} ${filterYear}`
      : filterYear !== "all"
        ? `Year ${filterYear}`
        : filterMonth !== "all"
          ? MONTHS[Number(filterMonth)]
          : "All Years"

  const reportCategoryLabel =
    filterCategory === "venue"
      ? "Event Venues"
      : filterCategory === "office"
        ? "Office Reservations"
        : "All Categories"
  const reportResourceLabel = selectedResourceOption?.name
    || (filterCategory === "venue"
      ? "All Event Venues"
      : filterCategory === "office"
        ? "All Offices"
        : "All Venues / Offices")
  const reportRoomLabel = selectedResourceOption?.category === "office"
    ? effectiveFilterRoom === "all"
      ? "All Rooms"
      : roomOptions.find((room) => room.id === effectiveFilterRoom)?.name || effectiveFilterRoom
    : "Not applicable"
  const isOfficeOnlyReport = filterCategory === "office"
    || selectedResourceOption?.category === "office"
    || (enrichedData.length > 0 && enrichedData.every((booking) => booking._category === "office"))

  const activeReportFilters = [
    filterCategory !== "all"
      ? `Booking Category: ${filterCategory === "venue" ? "Event Venues" : "Office Reservations"}`
      : "",
    selectedResourceOption ? `Venue / Office: ${selectedResourceOption.name}` : "",
    effectiveFilterRoom !== "all" ? `Office Room: ${roomOptions.find((room) => room.id === effectiveFilterRoom)?.name || effectiveFilterRoom}` : "",
    filterStatus !== "all" ? `Booking Status: ${prettifyStatus(filterStatus)}` : "",
    searchTerm.trim() ? `Search: ${searchTerm.trim()}` : "",
  ].filter(Boolean)
  const hasActiveFilters = Boolean(
    filterYear !== "all"
    || filterMonth !== "all"
    || filterStatus !== "all"
    || filterCategory !== "all"
    || effectiveFilterResource !== "all"
    || effectiveFilterRoom !== "all"
    || searchTerm.trim(),
  )
  const resetFilters = () => {
    setFilterYear("all")
    setFilterMonth("all")
    setFilterStatus("all")
    setFilterCategory("all")
    setFilterResource("all")
    setFilterRoom("all")
    setSearchTerm("")
    setCurrentPage(1)
  }
  const reportGeneratedAt = printDate ?? new Date()
  const reportSummaryItems: { label: string; value: string }[] = [
    { label: "Total Bookings", value: String(reportSummary.totalBookings) },
    { label: "Confirmed", value: String(reportSummary.confirmed) },
    { label: "Pending", value: String(reportSummary.pending) },
    { label: "Completed", value: String(reportSummary.completed) },
    { label: "Cancelled", value: String(reportSummary.cancelled) },
    { label: "Total Revenue", value: formatReportMoney(reportSummary.totalRevenue) },
    { label: "Total Refunds", value: formatReportMoney(reportSummary.totalRefunds) },
    { label: "Net Revenue", value: formatReportMoney(netRevenue) },
  ]

  const printReport = () => {
    // Commit fixed chart dimensions and the complete filtered row set before
    // the browser starts its print snapshot. Ctrl/Cmd+P is still covered by
    // the beforeprint listener above.
    flushSync(() => setPrintDate(new Date()))
    window.print()
  }

  const exportExcel = async () => {
    if (filteredData.length === 0) {
      toast({
        title: "No records available to export",
        description: "There are no records for the selected filters. Try adjusting the report filters.",
        className: "bg-slate-900 text-white",
      })
      return
    }

    try {
      const ExcelJS = (await import("exceljs")).default
      const workbook = new ExcelJS.Workbook()

      const now = new Date()
      const generatedDate = formatGeneratedDate(now)
      const generatedTime = formatGeneratedTime(now)
      const generatedOn = `${generatedDate}, ${generatedTime}`

      workbook.creator = generatedBy
      workbook.created = new Date()
      workbook.company = "One Estela Place"

      const worksheet = workbook.addWorksheet("Booking Records", {
        views: [{ state: "frozen", ySplit: 15 }],
      })
      worksheet.properties.showGridLines = false
      worksheet.properties.defaultRowHeight = 18

      const headerRow = 15
      const lastColumn = columnLetter(EXCEL_HEADERS.length)

      const dataRows = reportRows.map((row) => [
        row.bookingId,
        row.eventName,
        row.client,
        row.date,
        row.venue,
        row.bookingStatus,
        row.paymentStatus,
        row.totalAmount,
        row.remainingBalance,
        row.refundStatus,
        row.refundAmount,
      ])

      const companyCell = worksheet.getCell("A1")
      companyCell.value = "ONE ESTELA PLACE"
      companyCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } }
      companyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } }
      companyCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(1, 1, 1, EXCEL_HEADERS.length)
      worksheet.getRow(1).height = 30

      const subtitleCell = worksheet.getCell("A2")
      subtitleCell.value = "Event Management System"
      subtitleCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } }
      subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } }
      subtitleCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(2, 1, 2, EXCEL_HEADERS.length)
      worksheet.getRow(2).height = 16

      const titleCell = worksheet.getCell("A3")
      titleCell.value = "Booking Records Report"
      titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0F172A" } }
      titleCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(3, 1, 3, EXCEL_HEADERS.length)
      worksheet.getRow(3).height = 24

      const periodCell = worksheet.getCell("A4")
      periodCell.value = `Report Period: ${reportPeriod}`
      periodCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } }
      periodCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(4, 1, 4, EXCEL_HEADERS.length)
      worksheet.getRow(4).height = 18

      const metaCell = worksheet.getCell("A5")
      metaCell.value = `Generated Date: ${generatedDate}    •    Generated Time: ${generatedTime}    •    Generated By: ${generatedBy}`
      metaCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } }
      metaCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(5, 1, 5, EXCEL_HEADERS.length)
      worksheet.getRow(5).height = 18

      const accentRow = worksheet.getRow(6)
      accentRow.height = 4
      for (let columnIndex = 1; columnIndex <= EXCEL_HEADERS.length; columnIndex++) {
        accentRow.getCell(columnIndex).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEA580C" },
        }
      }

      try {
        const logoBase64 = await loadLogoBase64("/images/Favicon.png")
        if (logoBase64) {
          const logoImageId = workbook.addImage({
            base64: logoBase64,
            extension: "png",
          })
          worksheet.addImage(logoImageId, {
            tl: { col: 0, row: 0 },
            ext: { width: 30, height: 30 },
          })
        }
      } catch {
        // Logo is decorative only — fall back to the text banner when unavailable.
      }

      const summaryBar = worksheet.getCell("A7")
      summaryBar.value = "REPORT SUMMARY"
      summaryBar.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } }
      summaryBar.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } }
      summaryBar.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(7, 1, 7, EXCEL_HEADERS.length)
      worksheet.getRow(7).height = 20

      const summaryItems: { label: string; value: number; money?: boolean }[] = [
        { label: "Total Bookings", value: reportSummary.totalBookings },
        { label: "Confirmed", value: reportSummary.confirmed },
        { label: "Pending", value: reportSummary.pending },
        { label: "Completed", value: reportSummary.completed },
        { label: "Cancelled", value: reportSummary.cancelled },
        { label: "Total Revenue", value: reportSummary.totalRevenue, money: true },
        { label: "Total Refunds", value: reportSummary.totalRefunds, money: true },
      ]

      summaryItems.forEach((item, index) => {
        const rowNumber = 8 + index
        const rowFill = {
          type: "pattern" as const,
          pattern: "solid" as const,
          fgColor: { argb: index % 2 === 1 ? "FFF8FAFC" : "FFFFFFFF" },
        }

        const labelCell = worksheet.getCell(rowNumber, 1)
        labelCell.value = item.label
        labelCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } }
        labelCell.fill = rowFill
        labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 }
        labelCell.border = EXCEL_THIN_BORDER
        worksheet.mergeCells(rowNumber, 1, rowNumber, 8)

        const valueCell = worksheet.getCell(rowNumber, 9)
        valueCell.value = item.value
        valueCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F172A" } }
        valueCell.fill = rowFill
        valueCell.alignment = { vertical: "middle", horizontal: "right" }
        valueCell.border = EXCEL_THIN_BORDER
        if (item.money) valueCell.numFmt = PESO_NUMBER_FORMAT
        worksheet.mergeCells(rowNumber, 9, rowNumber, EXCEL_HEADERS.length)

        worksheet.getRow(rowNumber).height = 16
      })

      const headerCells = worksheet.getRow(headerRow)
      headerCells.height = 22
      EXCEL_HEADERS.forEach((header, columnIndex) => {
        const cell = headerCells.getCell(columnIndex + 1)
        cell.value = header
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } }
        cell.alignment = { vertical: "middle", horizontal: "center" }
        cell.border = EXCEL_THIN_BORDER
      })

      dataRows.forEach((values, index) => {
        const row = worksheet.getRow(headerRow + 1 + index)
        row.height = 20

        const moneyColumns = [8, 9, 11]
        const centerColumns = [4, 6, 7, 10]

        values.forEach((value, columnIndex) => {
          const columnNumber = columnIndex + 1
          const cell = row.getCell(columnNumber)
          cell.value = value
          cell.border = EXCEL_THIN_BORDER
          cell.font = { name: "Calibri", size: 10, color: { argb: "FF1F2937" } }

          if (columnNumber === 4 && value instanceof Date) {
            cell.numFmt = DATE_NUMBER_FORMAT
          }

          if (moneyColumns.includes(columnNumber) && typeof value === "number") {
            cell.numFmt = PESO_NUMBER_FORMAT
          }

          const horizontal = moneyColumns.includes(columnNumber)
            ? "right"
            : centerColumns.includes(columnNumber)
              ? "center"
              : "left"

          cell.alignment = { vertical: "middle", horizontal }
        })

        if (index % 2 === 1) {
          row.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } }
          })
        }
      })

      const lastDataRow = headerRow + dataRows.length
      computeColumnWidths(EXCEL_HEADERS, dataRows).forEach((width, columnIndex) => {
        worksheet.getColumn(columnIndex + 1).width = width
      })

      worksheet.autoFilter = `A${headerRow}:${lastColumn}${lastDataRow}`
      worksheet.pageSetup = {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: {
          left: 0.5,
          right: 0.5,
          top: 0.7,
          bottom: 0.7,
          header: 0.3,
          footer: 0.3,
        },
      }
      worksheet.headerFooter.oddHeader = ""
      worksheet.headerFooter.oddFooter =
        '&L&"Calibri"&8One Estela Place Event Management System  |  This report is system-generated.' +
        `&C&"Calibri"&8Generated: ${generatedOn} by ${generatedBy}` +
        '&R&"Calibri,Bold"&8Page &P of &N'

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const periodKey = `${filterYear === "all" ? "all-years" : filterYear}-${filterMonth === "all" ? "all-months" : MONTHS[Number(filterMonth)].toLowerCase()}`
      const fileName = `one-estela-reports-${periodKey}.xlsx`

      const url = URL.createObjectURL(blob)

      const link = document.createElement("a")
      link.href = url
      link.download = fileName
      link.click()

      URL.revokeObjectURL(url)

      toast({
        title: "Report exported",
        description: "Your Excel report has been downloaded.",
        className: "bg-slate-900 text-white",
      })
    } catch {
      toast({
        title: "Export failed",
        description: "Something went wrong while generating the Excel report. Please try again.",
        className: "bg-slate-900 text-white",
      })
    }
  }

  if (bookingsLoading && bookingList.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" />
        </div>
      </div>
    )
  }

  return (
    <div data-report-print-root className="mx-auto w-full max-w-7xl overflow-x-hidden bg-slate-50 px-4 py-3 sm:px-6 sm:py-4 lg:px-8 print:max-w-none print:bg-white print:p-0">
      <style media="print">{`
        @page { size: A4 landscape; margin: 10mm; }

        /* Keep only this page's print root and its ancestor path. */
        body:has([data-report-print-root]) *:not([data-report-print-root]):not([data-report-print-root] *):not(:has([data-report-print-root])) {
          display: none !important;
        }
        html:has([data-report-print-root]),
        body:has([data-report-print-root]),
        body :has([data-report-print-root]) {
          display: block !important;
          position: static !important;
          width: auto !important;
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          margin: 0 !important;
          padding: 0 !important;
          transform: none !important;
          scrollbar-gutter: auto !important;
          background: #fff !important;
        }
        [data-report-print-root] {
          display: block !important;
          width: 100% !important;
          max-width: none !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        [data-report-dashboard] { display: none !important; }
        [data-report-print-report] {
          display: block !important;
          width: 100% !important;
          color: #0f172a;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 9pt;
        }
        [data-report-print-report] * { box-sizing: border-box; }
        [data-report-print-banner] {
          padding: 5mm 6mm 4mm;
          color: #fff;
          text-align: center;
          background: #0f172a;
          border-bottom: 2mm solid #ea580c;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-report-print-banner] h1 {
          margin: 0;
          font-size: 17pt;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        [data-report-print-banner] p {
          margin: 1mm 0 0;
          color: #fff;
          font-size: 9pt;
          font-weight: 700;
        }
        [data-report-print-title] {
          padding: 4mm 0 2mm;
          text-align: center;
          break-after: avoid;
          page-break-after: avoid;
        }
        [data-report-print-title] h2 {
          margin: 0;
          color: #000;
          font-size: 14pt;
          font-weight: 800;
        }
        [data-report-print-title] p {
          margin: 1.5mm 0 0;
          color: #000;
          font-size: 9pt;
          font-weight: 700;
        }
        [data-report-print-meta] {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 2mm 5mm;
          padding: 2mm 0 3mm;
          border-bottom: 0.3mm solid #cbd5e1;
          color: #000;
          font-size: 8pt;
          font-weight: 700;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-report-print-meta] span { min-width: 0; }
        [data-report-print-meta] strong { color: #000; font-weight: 800; }
        [data-report-print-selection] {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 2mm 5mm;
          padding: 3mm 0 0;
          color: #000;
          font-size: 8pt;
          font-weight: 700;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-report-print-selection] span { min-width: 0; }
        [data-report-print-selection] strong { color: #000; font-weight: 800; }
        [data-report-print-summary] {
          margin-top: 4mm;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-report-print-summary] h3 {
          margin: 0;
          padding: 2.5mm 3mm;
          color: #fff;
          background: #1e293b;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        [data-report-print-summary-grid] {
          border: 0.3mm solid #cbd5e1;
          border-top: 0;
        }
        [data-report-print-summary-row] {
          display: flex;
          justify-content: space-between;
          gap: 8mm;
          padding: 1.6mm 3mm;
          border-top: 0.3mm solid #e2e8f0;
          font-size: 8.5pt;
        }
        [data-report-print-summary-row]:first-child { border-top: 0; }
        [data-report-print-summary-row]:nth-child(even) { background: #f8fafc; }
        [data-report-print-summary-row] span:first-child {
          color: #000;
          font-weight: 700;
        }
        [data-report-print-summary-row] span:last-child {
          color: #000;
          font-weight: 700;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        [data-report-print-analytics] {
          margin-top: 5mm;
          break-inside: auto;
          page-break-inside: auto;
        }
        [data-report-print-analytics-heading] {
          margin: 0 0 2mm;
          padding: 2.5mm 3mm;
          color: #fff;
          background: #1e293b;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          break-after: avoid;
          page-break-after: avoid;
        }
        [data-report-print-chart-grid] {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 4mm;
        }
        [data-report-print-chart-card] {
          min-width: 0;
          padding: 3.5mm;
          border: 0.3mm solid #cbd5e1;
          background: #fff;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-report-print-chart-card-wide] { grid-column: 1 / -1; }
        [data-report-print-chart-card] h4 {
          margin: 0;
          color: #000;
          font-size: 10pt;
          font-weight: 800;
        }
        [data-report-print-chart-card] p {
          margin: 1mm 0 2mm;
          color: #475569;
          font-size: 7.5pt;
          font-weight: 700;
        }
        [data-report-print-chart-canvas] {
          width: 100%;
          height: 58mm;
          overflow: visible !important;
        }
        [data-report-print-chart-canvas-compact] { height: 51mm; }
        [data-report-print-chart-canvas] .recharts-wrapper,
        [data-report-print-chart-canvas] .recharts-surface,
        [data-report-print-chart-canvas] svg {
          overflow: visible !important;
        }
        [data-report-print-chart-canvas] .recharts-legend-wrapper {
          overflow: visible !important;
          font-family: Arial, Helvetica, sans-serif !important;
        }
        [data-report-print-chart-canvas] .recharts-text {
          font-family: Arial, Helvetica, sans-serif !important;
        }
        [data-report-print-status-layout] {
          display: grid;
          grid-template-columns: 44mm minmax(0, 1fr);
          align-items: center;
          gap: 4mm;
          min-height: 42mm;
        }
        [data-report-print-status-chart] {
          width: 42mm;
          height: 42mm;
        }
        [data-report-print-status-legend] {
          display: grid;
          gap: 2mm;
          min-width: 0;
        }
        [data-report-print-status-legend] div {
          display: flex;
          align-items: center;
          gap: 2mm;
          min-width: 0;
          color: #334155;
          font-size: 8pt;
          font-weight: 700;
        }
        [data-report-print-status-legend] i {
          width: 3mm;
          height: 3mm;
          flex: 0 0 auto;
          border-radius: 50%;
        }
        [data-report-print-status-legend] span:last-child {
          margin-left: auto;
          color: #000;
          font-variant-numeric: tabular-nums;
        }
        [data-report-print-chart-empty] {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 43mm;
          border: 0.3mm dashed #cbd5e1;
          color: #64748b;
          font-size: 8pt;
          font-weight: 700;
          text-align: center;
        }
        [data-report-print-table] {
          margin-top: 5mm;
          width: 100%;
          overflow: visible !important;
        }
        [data-report-print-table-heading] {
          margin: 0 0 2mm;
          color: #000;
          font-size: 9pt;
          font-weight: 800;
          letter-spacing: 0.08em;
          break-after: avoid;
          page-break-after: avoid;
        }
        [data-report-print-table] table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 7.4pt;
        }
        [data-report-print-table] thead { display: table-header-group; }
        [data-report-print-table] tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-report-print-table] th,
        [data-report-print-table] td {
          padding: 1.7mm 1.2mm;
          border: 0.3mm solid #cbd5e1;
          vertical-align: middle;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        [data-report-print-table] th {
          color: #fff;
          background: #1e293b;
          font-size: 7pt;
          font-weight: 700;
          line-height: 1.2;
          text-align: center;
        }
        [data-report-print-table] td {
          color: #1f2937;
          line-height: 1.25;
        }
        [data-report-print-table] tbody tr:nth-child(even) { background: #f8fafc; }
        [data-report-print-table] .report-print-center { text-align: center; }
        [data-report-print-table] .report-print-money {
          text-align: right;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        [data-report-print-table] .report-print-empty {
          padding: 8mm;
          color: #64748b;
          text-align: center;
        }
      `}</style>

      <section data-report-print-report className="hidden" aria-label="Printable booking records report">
        <header data-report-print-banner>
          <h1>ONE ESTELA PLACE</h1>
          <p>Event Management System</p>
        </header>

        <div data-report-print-title>
          <h2>Venue Booking and Revenue Report</h2>
          <p>Reporting Period: {reportPeriod}</p>
          <p>Applied Filters: {activeReportFilters.length > 0 ? activeReportFilters.join(" | ") : "None"}</p>
        </div>

        <div data-report-print-selection>
          <span>
            <strong>Booking Category:</strong> {reportCategoryLabel}
          </span>
          <span>
            <strong>Venue / Office:</strong> {reportResourceLabel}
          </span>
          <span>
            <strong>Office Room:</strong> {reportRoomLabel}
          </span>
          <span>
            <strong>Records Included:</strong> {filteredData.length}
          </span>
        </div>

        <div data-report-print-meta>
          <span>
            <strong>Generated Date:</strong> {formatGeneratedDate(reportGeneratedAt)}
          </span>
          <span>
            <strong>Generated Time:</strong> {formatGeneratedTime(reportGeneratedAt)}
          </span>
          <span>
            <strong>Generated By:</strong> {generatedBy}
          </span>
        </div>

        <section data-report-print-summary>
          <h3>REPORT SUMMARY</h3>
          <div data-report-print-summary-grid>
            {reportSummaryItems.map((item) => (
              <div key={item.label} data-report-print-summary-row>
                <span>{item.label}</span>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section data-report-print-analytics aria-label="Visual analytics">
          <h3 data-report-print-analytics-heading>VISUAL ANALYTICS</h3>
          <div data-report-print-chart-grid>
            <article data-report-print-chart-card data-report-print-chart-card-wide>
              <h4>Monthly Performance</h4>
              <p>Booking volume and accepted/received revenue per month.</p>
              <div data-report-print-chart-canvas>
                {filteredData.length > 0 ? (
                  <ReportMonthlyPerformanceChart data={monthlyPerformance} isPrinting={isPrinting} printOnly />
                ) : (
                  <div data-report-print-chart-empty>No booking data available for the selected filters.</div>
                )}
              </div>
            </article>

            <article data-report-print-chart-card>
              <h4>Revenue per Venue</h4>
              <p>Based on accepted/received payment amounts.</p>
              <div data-report-print-chart-canvas data-report-print-chart-canvas-compact>
                {revenueByVenue.length > 0 ? (
                  <ReportRevenueByVenueChart data={revenueByVenue} isPrinting={isPrinting} printOnly />
                ) : (
                  <div data-report-print-chart-empty>No revenue data yet.</div>
                )}
              </div>
            </article>

            <article data-report-print-chart-card>
              <h4>Booking Status Distribution</h4>
              <p>Status breakdown for the selected records.</p>
              {statusCounts.length > 0 ? (
                <div data-report-print-status-layout>
                  <div data-report-print-status-chart data-report-print-chart-canvas>
                    <ReportStatusPieChart data={statusCounts} isPrinting={isPrinting} printOnly />
                  </div>
                  <div data-report-print-status-legend>
                    {statusCounts.map((entry) => (
                      <div key={entry.name}>
                        <i aria-hidden="true" style={{ backgroundColor: getStatusGroupColor(entry.name) }} />
                        <span>{entry.name}</span>
                        <span>{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div data-report-print-chart-empty>No status data.</div>
              )}
            </article>

            {!isOfficeOnlyReport && (
              <article data-report-print-chart-card data-report-print-chart-card-wide>
                <h4>Top Event Types</h4>
                <p>Shows which event categories are most booked.</p>
                <div data-report-print-chart-canvas>
                  {eventTypeCounts.length > 0 ? (
                    <ReportEventTypeChart data={eventTypeCounts} isPrinting={isPrinting} printOnly />
                  ) : (
                    <div data-report-print-chart-empty>No event type data.</div>
                  )}
                </div>
              </article>
            )}
          </div>
        </section>

        <section data-report-print-table aria-label="Booking records table">
          <h3 data-report-print-table-heading>BOOKING RECORDS</h3>
          <table>
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr>
                {EXCEL_HEADERS.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row, index) => (
                <tr key={`${row.bookingId}-${index}`}>
                  <td>{row.bookingId}</td>
                  <td>{row.eventName}</td>
                  <td>{row.client}</td>
                  <td className="report-print-center">{formatReportDate(row.date)}</td>
                  <td>{row.venue}</td>
                  <td className="report-print-center">{row.bookingStatus}</td>
                  <td className="report-print-center">{row.paymentStatus}</td>
                  <td className="report-print-money">{formatReportMoney(row.totalAmount)}</td>
                  <td className="report-print-money">{formatReportMoney(row.remainingBalance)}</td>
                  <td className="report-print-center">{row.refundStatus}</td>
                  <td className="report-print-money">{formatReportMoney(row.refundAmount)}</td>
                </tr>
              ))}
              {reportRows.length === 0 && (
                <tr>
                  <td colSpan={EXCEL_HEADERS.length} className="report-print-empty">
                    No booking records found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>

      <div data-report-dashboard>

      <div data-report-print-card className="mb-6 flex min-w-0 flex-col gap-4 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-slate-500">
          <span>
            Records: <b className="text-slate-950">{filteredData.length}</b>
          </span>
          <span>
            Gross Revenue: <b className="text-orange-600">{formatMoney(totalRevenue)}</b>
          </span>
          <span>
            Refunds: <b className="text-red-600">{totalRefunds > 0 ? "-" : ""}{formatMoney(totalRefunds)}</b>
          </span>
          <span>
            Net Revenue: <b className="text-emerald-600">{formatMoney(netRevenue)}</b>
          </span>
          <span>
            Confirmed: <b className="text-slate-950">{reportSummary.confirmed}</b>
          </span>
        </div>

        <div data-report-print-hidden className="flex w-full min-w-0 flex-col gap-3 print:hidden sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:flex-1">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search booking..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-xs font-bold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100 sm:w-[230px]"
            />
          </div>

          <Select
            value={filterStatus}
            onValueChange={(value) => {
              setFilterStatus(value)
              setCurrentPage(1)
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[175px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>

            <SelectContent className="rounded-xl shadow-xl">
              {statusOptions.map((status) => (
                <SelectItem key={status} value={status}>
                  {status === "all" ? "All Status" : prettifyStatus(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={exportExcel}
            disabled={filteredData.length === 0}
            className="h-10 w-full rounded-xl bg-orange-600 px-4 text-xs font-black text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export Excel
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={printReport}
            className="h-10 w-full rounded-xl border-slate-200 bg-white px-4 text-xs font-black text-slate-900 shadow-none hover:bg-slate-50 hover:text-slate-900 dark:border-slate-200 dark:bg-white dark:hover:bg-slate-50 sm:w-auto"
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print Report
          </Button>
        </div>
      </div>

      <div data-report-print-card className="mb-6 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div data-report-print-heading className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-orange-50 p-3 text-orange-700">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Monthly Performance</h3>
              <p className="text-xs font-semibold text-slate-500">
                 Shows booking volume and accepted/received revenue per month.
              </p>
            </div>
          </div>

          <div data-report-print-hidden className="flex flex-wrap items-center gap-2 sm:gap-3 print:hidden">
            <Select
              value={filterCategory}
              onValueChange={(value) => {
                setFilterCategory(value as ReportCategoryFilter)
                setFilterResource("all")
                setFilterRoom("all")
                setCurrentPage(1)
              }}
            >
              <SelectTrigger
                aria-label="Booking Category"
                className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[175px]"
              >
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All Categories" />
                </div>
              </SelectTrigger>

              <SelectContent className="rounded-xl shadow-xl">
                <SelectItem value="all" className="font-bold">
                  All Categories
                </SelectItem>
                <SelectItem value="venue">Event Venues</SelectItem>
                <SelectItem value="office">Office Reservations</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={effectiveFilterResource}
              onValueChange={(value) => {
                setFilterResource(value)
                setFilterRoom("all")
                setCurrentPage(1)
              }}
            >
              <SelectTrigger
                aria-label="Venue / Office"
                className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[220px]"
              >
                <SelectValue
                  placeholder={
                    filterCategory === "venue"
                      ? "All Event Venues"
                      : filterCategory === "office"
                        ? "All Offices"
                        : "All Venues / Offices"
                  }
                />
              </SelectTrigger>

              <SelectContent className="rounded-xl shadow-xl">
                <SelectItem value="all" className="font-bold">
                  {filterCategory === "venue"
                    ? "All Event Venues"
                    : filterCategory === "office"
                      ? "All Offices"
                      : "All Venues / Offices"}
                </SelectItem>
                {resourceOptions.map((resource) => (
                  <SelectItem
                    key={getResourceFilterValue(resource.category, resource.id)}
                    value={getResourceFilterValue(resource.category, resource.id)}
                  >
                    {resource.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedResourceOption?.category === "office" && roomOptions.length > 0 && (
              <Select
                value={effectiveFilterRoom}
                onValueChange={(value) => {
                  setFilterRoom(value)
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger
                  aria-label="Office Room"
                  className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[155px]"
                >
                  <SelectValue placeholder="All Rooms" />
                </SelectTrigger>

                <SelectContent className="rounded-xl shadow-xl">
                  <SelectItem value="all" className="font-bold">
                    All Rooms
                  </SelectItem>
                  {roomOptions.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select
              value={filterYear}
              onValueChange={(value) => {
                setFilterYear(value)
                setCurrentPage(1)
              }}
            >
              <SelectTrigger aria-label="Year" className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[130px]">
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All Years" />
                </div>
              </SelectTrigger>

              <SelectContent className="rounded-xl shadow-xl">
                <SelectItem value="all" className="font-bold">
                  All Years
                </SelectItem>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterMonth}
              onValueChange={(value) => {
                setFilterMonth(value)
                setCurrentPage(1)
              }}
            >
              <SelectTrigger aria-label="Month" className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[145px]">
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All Months" />
                </div>
              </SelectTrigger>

              <SelectContent className="rounded-xl shadow-xl">
                <SelectItem value="all" className="font-bold">
                  All Months
                </SelectItem>
                {MONTHS.map((month, index) => (
                  <SelectItem key={month} value={index.toString()}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                onClick={resetFilters}
                className="h-10 w-full rounded-xl border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900 sm:w-auto"
              >
                Reset Filters
              </Button>
            )}
          </div>
        </div>

        {filteredData.length === 0 ? (
          <div data-report-print-empty className="flex h-[280px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 sm:h-[320px]">
            <div className="rounded-2xl bg-white p-3 text-slate-400 shadow-sm">
              <BarChart3 className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-black text-slate-600">No booking data available for the selected period.</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">Try adjusting the selected filters.</p>
          </div>
        ) : (
          <div data-report-print-chart className="h-[280px] sm:h-[320px] w-full">
            <ReportMonthlyPerformanceChart data={monthlyPerformance} isPrinting={isPrinting} />
          </div>
        )}
      </div>

      <div data-report-print-charts className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div data-report-print-card className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div data-report-print-heading className="mb-6 flex items-center gap-3">
            <div className="rounded-2xl bg-orange-50 p-3 text-orange-700">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Revenue per Venue</h3>
              <p className="text-xs font-semibold text-slate-500">
                 Based on accepted/received payment amounts.
              </p>
            </div>
          </div>

          <div data-report-print-chart className="h-[250px] sm:h-[300px] w-full">
            {revenueByVenue.length > 0 ? (
              <ReportRevenueByVenueChart data={revenueByVenue} isPrinting={isPrinting} />
            ) : (
              <div data-report-print-empty className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                <div className="text-center">
                  <p className="text-sm font-black text-slate-500">No revenue data yet</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">
                    Confirmed or completed bookings will appear here.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          ref={statusCardRef}
          data-report-print-card
          className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div data-report-print-heading className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
              <PieChartIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Booking Status</h3>
              <p className="text-xs font-semibold text-slate-500">Status breakdown by filter.</p>
            </div>
          </div>

          {statusCounts.length > 0 ? (
            <div data-report-print-status-layout className={isWideLayout ? "flex items-center gap-10" : "flex flex-col gap-6"}>
              <div className={isWideLayout ? "w-[45%] shrink-0" : "w-full"}>
                <div data-report-print-status-chart className="mx-auto aspect-square w-full max-w-[280px] sm:max-w-[300px]">
                  <ReportStatusPieChart data={statusCounts} isPrinting={isPrinting} />
                </div>
              </div>
              <div className={isWideLayout ? "min-w-0 w-[55%]" : "w-full"}>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {statusCounts.map((entry) => (
                    <div key={entry.name} className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: getStatusGroupColor(entry.name) }}
                      />
                      <span
                        className={`min-w-0 ${
                          isWideLayout ? "text-sm" : "text-[13px]"
                        } font-semibold leading-snug text-slate-600`}
                      >
                        {entry.name}
                      </span>
                      <span className="ml-auto shrink-0 text-sm font-bold tabular-nums text-slate-900">
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div data-report-print-empty className="flex h-[220px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
              <p className="text-sm font-black text-slate-400">No status data.</p>
            </div>
          )}
        </div>
      </div>

      <div data-report-print-card className="mb-6 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div data-report-print-heading className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-orange-50 p-3 text-orange-700">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-950">Top Event Types</h3>
            <p className="text-xs font-semibold text-slate-500">
              Shows which event categories are most booked.
            </p>
          </div>
        </div>

        <div data-report-print-chart className="h-[250px] sm:h-[300px] w-full">
          {eventTypeCounts.length > 0 ? (
            <ReportEventTypeChart data={eventTypeCounts} isPrinting={isPrinting} />
            ) : (
              <div data-report-print-empty className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                <p className="px-4 text-center text-sm font-black text-slate-400">
                  {filterCategory === "office"
                    ? "Event types do not apply to office reservations."
                    : "No event type data."}
                </p>
              </div>
            )}
        </div>
      </div>

      <div data-report-print-table className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div data-report-print-heading className="flex items-center border-b border-slate-100 bg-slate-50 px-6 py-5">
          <h3 className="text-lg font-black text-slate-950">Booking Records</h3>
          <p className="ml-2 text-xs font-semibold text-slate-500">({filteredData.length} record{filteredData.length === 1 ? "" : "s"})</p>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[950px] text-left text-sm print:min-w-0">
            <thead className="border-b border-slate-100 bg-white text-[10px] font-black uppercase tracking-[0.2em] text-slate-950">
              <tr>
                <th className="p-5 pl-8">Booking ID</th>
                <th className="p-5">Event Details</th>
                <th className="p-5">Client</th>
                <th className="p-5">Date</th>
                <th className="p-5">Status</th>
                <th className="p-5 pr-8 text-right">Amount</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {(isPrinting ? enrichedData : paginatedData).map((booking, index) => {
                const status = booking.status || "pending"
                const clientName = getReportClientName(booking)

                return (
                  <tr key={`${booking.id || "booking"}-${index}`} className="transition-colors hover:bg-slate-50">
                    <td className="p-5 pl-8">
                      <p className="font-black text-slate-500">{booking.id || "N/A"}</p>
                    </td>

                    <td className="p-5">
                      <p className="font-black text-slate-950">
                        {booking.eventName || booking.eventType || "Untitled Event"}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{booking.venue || "No venue selected"}</p>
                    </td>

                    <td className="p-5">
                      <p className="font-bold text-slate-700">{clientName}</p>
                    </td>

                    <td className="p-5">
                      <p className="font-bold text-slate-700">{formatDate(booking)}</p>
                    </td>

                    <td className="p-5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${getStatusBadgeClass(
                          status
                        )}`}
                      >
                        {prettifyStatus(status)}
                      </span>
                    </td>

                    <td className="p-5 pr-8 text-right">
                      <p className="text-lg font-black text-orange-600">{formatMoney(getBookingAmount(booking))}</p>
                    </td>
                  </tr>
                )
              })}

              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <div className="mx-auto max-w-sm">
                      <p className="text-base font-black text-slate-600">No booking records found for the selected filters.</p>
                      <p className="mt-1 text-sm font-semibold text-slate-400">
                        Try adjusting the category, venue, room, date, status, or search filter.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div data-report-print-hidden className="flex items-center justify-center gap-4 border-t border-slate-100 px-6 py-4 print:hidden">
            <button
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <p className="text-xs font-bold text-slate-500">
              Page <span className="font-black text-slate-900">{safePage}</span> of{" "}
              <span className="font-black text-slate-900">{totalPages}</span>
            </p>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
