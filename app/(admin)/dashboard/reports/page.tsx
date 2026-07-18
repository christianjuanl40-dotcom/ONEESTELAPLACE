"use client"

import React, { useEffect, useMemo, useState } from "react"
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
import { useBookings } from "@/src/modules/client/contexts/booking-context"
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

const PIE_COLORS = ["#ea580c", "#10b981", "#3b82f6", "#f59e0b", "#f43f5e", "#8b5cf6", "#14b8a6"]

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

function escapeCSV(value: unknown) {
  const text = String(value ?? "")
  return `"${text.replace(/"/g, '""')}"`
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

export default function ReportsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const { bookings = [] } = useBookings()

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.reports) {
      router.replace("/dashboard")
    }
  }, [user, router])

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

  const filteredData = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    return bookingList
      .filter((booking) => {
        const parsedDate = parseBookingDate(booking)
        const bookingStatus = normalizeStatus(booking.status)

        const matchesMonth =
          filterMonth === "all" || (parsedDate && parsedDate.getMonth().toString() === filterMonth)

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

        return matchesMonth && matchesStatus && matchesSearch
      })
      .sort((a, b) => {
        const dateA = parseBookingDate(a)?.getTime() || 0
        const dateB = parseBookingDate(b)?.getTime() || 0
        return dateB - dateA
      })
  }, [bookingList, filterMonth, filterStatus, searchTerm])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filterMonth, filterStatus, rowsPerPage])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedData = useMemo(
    () => filteredData.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage),
    [filteredData, safePage, rowsPerPage],
  )

  const confirmedBookings = useMemo(() => {
    return filteredData.filter((booking) => CONFIRMED_STATUSES.includes(normalizeStatus(booking.status)))
  }, [filteredData])

  const totalRevenue = useMemo(() => {
    return confirmedBookings.reduce((sum, booking) => sum + getBookingAmount(booking), 0)
  }, [confirmedBookings])

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
      const status = prettifyStatus(booking.status)
      map[status] = (map[status] || 0) + 1
    })

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
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

  const exportCSV = () => {
    if (filteredData.length === 0) {
      toast({
        title: "No records to export",
        description: "Try changing your report filters first.",
        className: "bg-slate-900 text-white",
      })
      return
    }

    const headers = [
      "Booking ID",
      "Event Name",
      "Client",
      "Date",
      "Venue",
      "Status",
      "Payment Status",
      "Total Amount",
    ]

    const rows = filteredData.map((booking) => [
      booking.id || "N/A",
      booking.eventName || booking.eventType || "Untitled Event",
      booking.customerName || booking.clientName || booking.name || "N/A",
      formatDate(booking),
      booking.venue || "N/A",
      prettifyStatus(booking.status),
      booking.paymentStatus ? prettifyStatus(booking.paymentStatus) : "N/A",
      getBookingAmount(booking),
    ])

    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n")

    const selectedMonth = filterMonth === "all" ? "all-months" : MONTHS[Number(filterMonth)].toLowerCase()
    const fileName = `one-estela-reports-${selectedMonth}.csv`

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)

    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    link.click()

    URL.revokeObjectURL(url)

    toast({
      title: "Report exported",
      description: "Your CSV report has been downloaded.",
      className: "bg-slate-900 text-white",
    })
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
      <div className="border-b border-slate-200 pb-5 mb-5">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
            Admin Reports & Analytics
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
            Reports & Analytics
          </h1>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
            Review booking records, revenue trends, event performance, and downloadable report summaries.
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-slate-500">
          <span>
            Records: <b className="text-slate-950">{filteredData.length}</b>
          </span>
          <span>
            Verified Revenue: <b className="text-orange-600">{formatMoney(totalRevenue)}</b>
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

          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[160px]">
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
            onClick={exportCSV}
            disabled={filteredData.length === 0}
            className="h-10 rounded-xl bg-orange-600 px-4 text-xs font-black text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
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

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
              <PieChartIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-950">Booking Status</h3>
              <p className="text-xs font-semibold text-slate-500">Status breakdown by filter.</p>
            </div>
          </div>

          <div className="h-[250px] sm:h-[300px] w-full">
            {statusCounts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusCounts}
                    cx="50%"
                    cy="48%"
                    innerRadius={58}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {statusCounts.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
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
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                <p className="text-sm font-black text-slate-400">No status data.</p>
              </div>
            )}
          </div>
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
                const clientName = booking.customerName || booking.clientName || booking.name || "Walk-in / Guest"

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
                        className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${getStatusBadgeClass(
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
                      <p className="text-base font-black text-slate-600">No records found</p>
                      <p className="mt-1 text-sm font-semibold text-slate-400">
                        Try changing the month, status, or search keyword.
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