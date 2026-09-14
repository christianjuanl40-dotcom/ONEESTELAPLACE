"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  CalendarDays,
  Download,
  Filter,
  PieChart as PieChartIcon,
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
import { calculatePaymentSummary, getRecordsForBooking } from "@/src/modules/shared/lib/payment-calculations"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type BookingRecord = {
  id?: string | number
  eventName?: string
  eventType?: string
  customerName?: string
  clientName?: string
  name?: string
  date?: string
  eventDate?: string
  createdAt?: string
  venue?: string
  status?: string
  paymentStatus?: string
  totalPrice?: number | string
  totalAmount?: number | string
  amount?: number | string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const STATUS_GROUPS = [
  { name: "Active", color: "#10B981", statuses: ["confirmed", "active_rental"] },
  { name: "Payment Verification", color: "#3B82F6", statuses: ["verifying"] },
  { name: "Pending", color: "#F59E0B", statuses: ["pending"] },
  { name: "Contract Signing", color: "#8B5CF6", statuses: ["contract_signing_required"] },
  { name: "Refund Requests", color: "#F97316", statuses: ["cancellation_requested", "cancellation requested"] },
  { name: "Cancelled", color: "#EF4444", statuses: ["cancelled", "canceled"] },
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

const CONFIRMED_STATUSES = ["confirmed", "completed"]
const PENDING_STATUSES = ["pending", "pencil booking", "for review", "for verification", "awaiting payment"]
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
  const value = booking.totalPrice ?? booking.totalAmount ?? booking.amount ?? 0
  const amount = Number(value)

  return Number.isFinite(amount) ? amount : 0
}

function formatMoney(value: number) {
  return `₱${Number(value || 0).toLocaleString("en-PH")}`
}

function abbreviateMoney(value: number) {
  if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `₱${Math.round(value / 1_000)}k`
  return `₱${value}`
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

function getVenueName(venue?: string) {
  if (!venue) return "Unassigned"
  return venue.split(" - ")[0]?.trim() || venue
}

function getEventType(booking: BookingRecord) {
  return booking.eventType || booking.eventName || "Unspecified"
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

const BOOKING_LIFECYCLE_MAP: Record<string, string> = {
  pending: "Pending",
  verifying: "Pending",
  for_review: "Pending",
  "for review": "Pending",
  modification_under_review: "Pending",
  cancellation_requested: "Pending",
  "cancellation requested": "Pending",
  confirmed: "Confirmed",
  approved: "Confirmed",
  reservation_secured: "Confirmed",
  contract_signing_required: "Confirmed",
  active_rental: "Ongoing",
  completed: "Completed",
  rental_expired: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  declined: "Cancelled",
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

function getReportRemainingBalance(booking: BookingRecord, summary?: { remainingBalance: number } | null) {
  if (summary) return summary.remainingBalance
  const b = booking as any
  const stored = Number(b.remainingBalance ?? 0) || 0
  if (stored > 0) return stored
  const totalAmount = getBookingAmount(booking)
  const amountPaid = Number(b.amountPaid ?? b.paymentAmount ?? b.paidAmount ?? 0) || 0
  return Math.max(totalAmount - amountPaid, 0)
}

function getReportRefundAmount(booking: BookingRecord) {
  const amount = Number((booking as any).refundAmount ?? 0)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function getBookingLifecycleLabel(status?: string) {
  const normalized = normalizeStatus(status)
  return BOOKING_LIFECYCLE_MAP[normalized] ?? "Pending"
}

function getReportPaymentStatus(booking: BookingRecord, summary?: { overallStatus: string; remainingBalance: number } | null) {
  if (summary) {
    const canonicalLabelMap: Record<string, string> = {
      completed: "Fully Paid",
      partial: "Partially Paid",
      for_review: "For Verification",
      rejected: "Rejected",
      incomplete: "Partially Paid",
    }
    return canonicalLabelMap[summary.overallStatus] || "Pending Payment"
  }

  const b = booking as any
  const ps = normalizeStatus(booking.paymentStatus)
  const stage = String(b.paymentStage || "").toLowerCase()
  const totalAmount = getBookingAmount(booking)
  const amountPaid = Number(b.amountPaid ?? b.paymentAmount ?? b.paidAmount ?? 0) || 0
  const remainingBalance = getReportRemainingBalance(booking)
  const refundStatus = normalizeStatus(b.refundStatus)

  if (refundStatus === "refunded") return "Refunded"
  if (ps === "rejected") return "Rejected"
  if (
    ps === "for_review" ||
    ps === "cash_pending" ||
    ps === "slot_pending" ||
    ps === "pending_verification" ||
    ps === "pending verification" ||
    ps === "for verification"
  ) {
    return "For Verification"
  }
  if (
    (stage === "fully paid" ||
      ps === "paid" ||
      ps === "fully paid" ||
      ps === "verified" ||
      ps === "slot_verified" ||
      ps === "completed") &&
    remainingBalance === 0 &&
    totalAmount > 0
  ) {
    return "Fully Paid"
  }
  if (remainingBalance > 0 && amountPaid > 0) {
    const downPaymentAmount = Number(b.downPaymentAmount ?? b.selectedDownpaymentAmount ?? 0) || 0
    if (downPaymentAmount > 0 && amountPaid >= downPaymentAmount) return "DP Paid"
    return "Partially Paid"
  }
  if (ps === "partial" || ps === "incomplete") return "Partially Paid"
  if (ps === "verified" || ps === "slot_verified") return "Fully Paid"
  return "Pending Payment"
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

export default function ReportsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const { bookings = [], paymentRecords = [], isLoading: bookingsLoading } = useBookingData({ bookings: true, payments: true })
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
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const bookingList = useMemo(() => {
    return Array.isArray(bookings) ? (bookings as BookingRecord[]) : []
  }, [bookings])

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>()

    bookingList.forEach((booking) => {
      statuses.add(normalizeStatus(booking.status))
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

  const filteredData = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    return bookingList
      .filter((booking) => {
        const parsedDate = parseBookingDate(booking)
        const bookingStatus = normalizeStatus(booking.status)
        const bookingYear = parsedDate ? parsedDate.getFullYear().toString() : ""

        const matchesMonth =
          filterMonth === "all" || (parsedDate && parsedDate.getMonth().toString() === filterMonth)

        const matchesYear = filterYear === "all" || bookingYear === filterYear

        const matchesStatus = filterStatus === "all" || bookingStatus === filterStatus

        const searchableText = [
          booking.id,
          booking.eventName,
          booking.eventType,
          booking.customerName,
          booking.clientName,
          booking.name,
          booking.venue,
          booking.status,
          booking.paymentStatus,
          getBookingDate(booking),
          (booking as any).bookingCategory,
          (booking as any).officeName,
          (booking as any).officeRoom,
        ]
          .join(" ")
          .toLowerCase()

        const matchesSearch = !keyword || searchableText.includes(keyword)

        return matchesYear && matchesMonth && matchesStatus && matchesSearch
      })
      .sort((a, b) => {
        const dateA = parseBookingDate(a)?.getTime() || 0
        const dateB = parseBookingDate(b)?.getTime() || 0
        return dateB - dateA
      })
  }, [bookingList, filterYear, filterMonth, filterStatus, searchTerm])

  const enrichedData = useMemo(() => {
    const records = Array.isArray(paymentRecords) ? paymentRecords : []
    return filteredData.map((booking) => {
      const summary = calculatePaymentSummary(booking as any, getRecordsForBooking(records, String(booking.id)))
      return { ...booking, _summary: summary }
    })
  }, [filteredData, paymentRecords])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filterYear, filterMonth, filterStatus, rowsPerPage])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedData = useMemo(
    () => enrichedData.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage),
    [enrichedData, safePage, rowsPerPage],
  )

  const confirmedBookings = useMemo(() => {
    return filteredData.filter((booking) => CONFIRMED_STATUSES.includes(normalizeStatus(booking.status)))
  }, [filteredData])

  const totalRevenue = useMemo(() => {
    return confirmedBookings.reduce((sum, booking) => sum + getBookingAmount(booking), 0)
  }, [confirmedBookings])

  const totalRefunds = useMemo(() => {
    return filteredData
      .filter((booking) => (booking as any).refundStatus === "refunded" && (booking as any).refundAmount)
      .reduce((sum, booking) => sum + (Number((booking as any).refundAmount) || 0), 0)
  }, [filteredData])

  const netRevenue = useMemo(() => {
    return totalRevenue - totalRefunds
  }, [totalRevenue, totalRefunds])

  const monthlyPerformance = useMemo(() => {
    const map = MONTHS.map((month) => ({
      month,
      revenue: 0,
      bookings: 0,
    }))

    filteredData.forEach((booking) => {
      const parsedDate = parseBookingDate(booking)
      if (!parsedDate) return

      const monthIndex = parsedDate.getMonth()
      map[monthIndex].bookings += 1

      if (CONFIRMED_STATUSES.includes(normalizeStatus(booking.status))) {
        map[monthIndex].revenue += getBookingAmount(booking)
      }
    })

    return filterMonth === "all" ? map : map.filter((_, index) => index.toString() === filterMonth)
  }, [filteredData, filterMonth])

  const revenueByVenue = useMemo(() => {
    const map: Record<string, number> = {}

    confirmedBookings.forEach((booking) => {
      const venue = getVenueName(booking.venue)
      map[venue] = (map[venue] || 0) + getBookingAmount(booking)
    })

    return Object.entries(map)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
  }, [confirmedBookings])

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {}

    filteredData.forEach((booking) => {
      const group = getStatusGroupName(booking.status)
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

    filteredData.forEach((booking) => {
      const eventType = getEventType(booking)
      map[eventType] = (map[eventType] || 0) + 1
    })

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [filteredData])

  const exportExcel = async () => {
    if (filteredData.length === 0) {
      toast({
        title: "No records available to export",
        description: "There are no records for the selected period. Try adjusting the year or month filter.",
        className: "bg-slate-900 text-white",
      })
      return
    }

    try {
      const ExcelJS = (await import("exceljs")).default
      const workbook = new ExcelJS.Workbook()

      const generatedBy = user?.fullName || user?.name || user?.email || "System User"
      const now = new Date()
      const generatedDate = new Intl.DateTimeFormat("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(now)
      const generatedTime = new Intl.DateTimeFormat("en-PH", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(now)
      const generatedOn = `${generatedDate}, ${generatedTime}`

      const reportPeriod =
        filterYear !== "all" && filterMonth !== "all"
          ? `${MONTHS[Number(filterMonth)]} ${filterYear}`
          : filterYear !== "all"
            ? `Year ${filterYear}`
            : filterMonth !== "all"
              ? MONTHS[Number(filterMonth)]
              : "All Years"

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

      const dataRows = enrichedData.map((booking) => {
        const parsedDate = parseBookingDate(booking)
        const dateCell = parsedDate ? new Date(parsedDate.getTime()) : getBookingDate(booking) || "No date"
        if (dateCell instanceof Date) dateCell.setHours(12, 0, 0, 0)

        return [
          booking.id || "N/A",
          booking.eventName || booking.eventType || "Untitled Event",
          getReportClientName(booking),
          dateCell,
          booking.venue || "N/A",
          getBookingLifecycleLabel(booking.status),
          getReportPaymentStatus(booking, (booking as any)._summary),
          getBookingAmount(booking),
          getReportRemainingBalance(booking, (booking as any)._summary),
          (booking as any).refundStatus || "N/A",
          getReportRefundAmount(booking),
        ]
      })

      const companyCell = worksheet.getCell("A1")
      companyCell.value = "ONE ESTELA PLACE"
      companyCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } }
      companyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } }
      companyCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(1, 1, 1, EXCEL_HEADERS.length)
      worksheet.getRow(1).height = 30

      const subtitleCell = worksheet.getCell("A2")
      subtitleCell.value = "Event Management System"
      subtitleCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FFCBD5E1" } }
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
      periodCell.font = { name: "Calibri", size: 10, color: { argb: "FF475569" } }
      periodCell.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(4, 1, 4, EXCEL_HEADERS.length)
      worksheet.getRow(4).height = 18

      const metaCell = worksheet.getCell("A5")
      metaCell.value = `Generated Date: ${generatedDate}    •    Generated Time: ${generatedTime}    •    Generated By: ${generatedBy}`
      metaCell.font = { name: "Calibri", size: 10, color: { argb: "FF475569" } }
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

      const summaryTotalBookings = filteredData.length
      const summaryConfirmed = filteredData.filter(
        (b) => getBookingLifecycleLabel(b.status) === "Confirmed",
      ).length
      const summaryPending = filteredData.filter(
        (b) => getBookingLifecycleLabel(b.status) === "Pending",
      ).length
      const summaryCompleted = filteredData.filter(
        (b) => getBookingLifecycleLabel(b.status) === "Completed",
      ).length
      const summaryCancelled = filteredData.filter(
        (b) => getBookingLifecycleLabel(b.status) === "Cancelled",
      ).length

      const summaryBar = worksheet.getCell("A7")
      summaryBar.value = "REPORT SUMMARY"
      summaryBar.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } }
      summaryBar.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } }
      summaryBar.alignment = { vertical: "middle", horizontal: "center" }
      worksheet.mergeCells(7, 1, 7, EXCEL_HEADERS.length)
      worksheet.getRow(7).height = 20

      const summaryItems: { label: string; value: number; money?: boolean }[] = [
        { label: "Total Bookings", value: summaryTotalBookings },
        { label: "Confirmed", value: summaryConfirmed },
        { label: "Pending", value: summaryPending },
        { label: "Completed", value: summaryCompleted },
        { label: "Cancelled", value: summaryCancelled },
        { label: "Total Revenue", value: totalRevenue, money: true },
        { label: "Total Refunds", value: totalRefunds, money: true },
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
        labelCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF334155" } }
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
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
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
            Confirmed: <b className="text-slate-950">{confirmedBookings.length}</b>
          </span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search booking..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-xs font-bold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100 sm:w-[230px]"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
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
            className="h-10 rounded-xl bg-orange-600 px-4 text-xs font-black text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export Excel
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-orange-50 p-3 text-orange-700">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Monthly Performance</h3>
              <p className="text-xs font-semibold text-slate-500">
                Shows booking volume and verified revenue per month.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[130px]">
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

            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[145px]">
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
          </div>
        </div>

        {filteredData.length === 0 ? (
          <div className="flex h-[280px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 sm:h-[320px]">
            <div className="rounded-2xl bg-white p-3 text-slate-400 shadow-sm">
              <BarChart3 className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-black text-slate-600">No booking data available for the selected period.</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">Try a different year or month.</p>
          </div>
        ) : (
          <div className="h-[280px] sm:h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyPerformance} margin={{ top: 10, right: 10, left: -18, bottom: 5 }}>
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
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
              />
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
              <Bar yAxisId="left" dataKey="revenue" fill="#ea580c" radius={[8, 8, 0, 0]} name="Revenue" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="bookings"
                stroke="#0f172a"
                strokeWidth={3}
                dot={{ r: 4 }}
                name="Bookings"
              />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-2xl bg-orange-50 p-3 text-orange-700">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Revenue per Venue</h3>
              <p className="text-xs font-semibold text-slate-500">
                Based on confirmed and completed bookings only.
              </p>
            </div>
          </div>

          <div className="h-[250px] sm:h-[300px] w-full">
            {revenueByVenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByVenue} margin={{ top: 5, right: 10, left: -18, bottom: 5 }}>
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
                  />
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
                  <Bar dataKey="total" fill="#ea580c" radius={[8, 8, 0, 0]} barSize={42} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
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
          className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
              <PieChartIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Booking Status</h3>
              <p className="text-xs font-semibold text-slate-500">Status breakdown by filter.</p>
            </div>
          </div>

          {statusCounts.length > 0 ? (
            <div className={isWideLayout ? "flex items-center gap-10" : "flex flex-col gap-6"}>
              <div className={isWideLayout ? "w-[45%] shrink-0" : "w-full"}>
                <div className="mx-auto aspect-square w-full max-w-[280px] sm:max-w-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusCounts}
                        cx="50%"
                        cy="50%"
                        innerRadius="56%"
                        outerRadius="80%"
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {statusCounts.map((entry) => (
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
            <div className="flex h-[220px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
              <p className="text-sm font-black text-slate-400">No status data.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
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

        <div className="h-[250px] sm:h-[300px] w-full">
          {eventTypeCounts.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eventTypeCounts} margin={{ top: 5, right: 10, left: -18, bottom: 5 }}>
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
                />
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
                <Bar dataKey="value" fill="#0f172a" radius={[8, 8, 0, 0]} barSize={42} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
              <p className="text-sm font-black text-slate-400">No event type data.</p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center border-b border-slate-100 bg-slate-50 px-6 py-5">
          <h3 className="text-lg font-black text-slate-950">Booking Records</h3>
          <p className="ml-2 text-xs font-semibold text-slate-500">({filteredData.length} record{filteredData.length === 1 ? "" : "s"})</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-white text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
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
              {paginatedData.map((booking, index) => {
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
                      <p className="text-base font-black text-slate-600">No booking records found for the selected period.</p>
                      <p className="mt-1 text-sm font-semibold text-slate-400">
                        Try adjusting the year, month, status, or search keyword.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 border-t border-slate-100 px-6 py-4">
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
  )
}