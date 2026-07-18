"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useStaff, type StaffAccount } from "@admin/contexts/staff-context"
import { Button } from "@shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@shared/components/ui/dialog"
import { Input } from "@shared/components/ui/input"
import { Label } from "@shared/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select"
import { useToast } from "@shared/hooks/use-toast"
import { Checkbox } from "@shared/components/ui/checkbox"
import {
  Edit2,
  Plus,
  Power,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
  Trash2,
} from "lucide-react"
import type { StaffPermissions } from "@/src/modules/shared/types/permissions"
import { DEFAULT_STAFF_PERMISSIONS, PERMISSION_LABELS } from "@/src/modules/shared/types/permissions"

type StaffStatus = "Active" | "Inactive"

type StaffFormData = {
  firstName: string
  lastName: string
  email: string
  position: string
  password: string
  status: StaffStatus
  permissions: StaffPermissions
}

const DEFAULT_FORM: StaffFormData = {
  firstName: "",
  lastName: "",
  email: "",
  position: "",
  password: "",
  status: "Active",
  permissions: { ...DEFAULT_STAFF_PERMISSIONS },
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeStaffStatus(status?: string): StaffStatus {
  return String(status || "").trim().toLowerCase() === "inactive" ? "Inactive" : "Active"
}

function getFullName(staff: Pick<StaffAccount, "firstName" | "lastName">) {
  return `${staff.firstName || ""} ${staff.lastName || ""}`.trim()
}

function getInitials(firstName?: string, lastName?: string) {
  const first = firstName?.charAt(0) || ""
  const last = lastName?.charAt(0) || ""
  return `${first}${last}`.toUpperCase() || "ST"
}

function getStatusBadgeClass(status: string) {
  return normalizeStaffStatus(status) === "Active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700"
}

export default function StaffManagementPage() {
  const { user } = useAuth()
  const router = useRouter()
  const {
    staff,
    loading,
    addStaff,
    updateStaff,
    deactivateStaff,
    activateStaff,
    deleteStaff,
    toggleStaffPermission,
  } = useStaff()

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/dashboard")
    }
  }, [user, router])
  const { toast } = useToast()

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffAccount | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | StaffStatus>("all")
  const [formData, setFormData] = useState<StaffFormData>(DEFAULT_FORM)
  const [staffPage, setStaffPage] = useState(1)
  const STAFF_PER_PAGE = 10

  const filteredStaff = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    return staff
      .filter((staffMember: StaffAccount) => {
        const normalizedStatus = normalizeStaffStatus(staffMember.status)
        const matchesStatus = statusFilter === "all" || normalizedStatus === statusFilter

        const searchableText = [
          staffMember.firstName,
          staffMember.lastName,
          staffMember.email,
          staffMember.position,
          staffMember.status,
        ]
          .join(" ")
          .toLowerCase()

        const matchesSearch = !keyword || searchableText.includes(keyword)

        return matchesStatus && matchesSearch
      })
      .sort((a: StaffAccount, b: StaffAccount) => {
        const statusA = normalizeStaffStatus(a.status)
        const statusB = normalizeStaffStatus(b.status)

        if (statusA !== statusB) return statusA === "Active" ? -1 : 1
        return getFullName(a).localeCompare(getFullName(b))
      })
  }, [staff, searchTerm, statusFilter])

  useEffect(() => {
    setStaffPage(1)
  }, [searchTerm, statusFilter])

  const staffTotalPages = Math.ceil(filteredStaff.length / STAFF_PER_PAGE)
  const safeStaffPage = staffPage > staffTotalPages ? Math.max(staffTotalPages, 1) : staffPage
  const paginatedStaff = filteredStaff.slice(
    (safeStaffPage - 1) * STAFF_PER_PAGE,
    safeStaffPage * STAFF_PER_PAGE,
  )

  const resetForm = () => {
    setFormData(DEFAULT_FORM)
    setEditingStaff(null)
  }

  const updateForm = (key: keyof StaffFormData, value: string | StaffPermissions) => {
    setFormData((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const toggleFormPermission = (permission: keyof StaffPermissions) => {
    setFormData((current) => ({
      ...current,
      permissions: {
        ...current.permissions,
        [permission]: !current.permissions[permission],
      },
    }))
  }

  const validateForm = (mode: "add" | "edit") => {
    const firstName = cleanText(formData.firstName)
    const lastName = cleanText(formData.lastName)
    const email = normalizeEmail(formData.email)
    const position = cleanText(formData.position)
    const password = formData.password

    if (!firstName || !lastName || !email || !position) {
      toast({
        title: "Missing required fields",
        description: "Please complete first name, last name, email, and position.",
        variant: "destructive",
      })
      return null
    }

    if (!EMAIL_REGEX.test(email)) {
      toast({
        title: "Invalid email address",
        description: "Please enter a valid staff email address.",
        variant: "destructive",
      })
      return null
    }

    if (mode === "add" && (!password || password.length < 6)) {
      toast({
        title: "Invalid password",
        description: "Temporary password must be at least 6 characters.",
        variant: "destructive",
      })
      return null
    }

    const duplicateEmail = staff.some((staffMember: StaffAccount) => {
      const sameEmail = normalizeEmail(staffMember.email) === email
      const notCurrentStaff = !editingStaff || staffMember.uid !== editingStaff.uid
      return sameEmail && notCurrentStaff
    })

    if (duplicateEmail) {
      toast({
        title: "Email already exists",
        description: "Another staff member is already using this email.",
        variant: "destructive",
      })
      return null
    }

    return { firstName, lastName, email, position, password }
  }

  const handleAddStaff = async () => {
    const payload = validateForm("add")
    if (!payload) return

    setIsSaving(true)
    try {
      const uid = await addStaff({
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        password: payload.password,
        position: payload.position,
        permissions: formData.permissions,
      })
      setIsSaving(false)

      if (!uid) {
        toast({
          title: "Failed to add staff",
          description: "An error occurred while creating the staff account. Check the console for details.",
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Staff added",
        description: `${payload.firstName} ${payload.lastName} has been added as Staff.`,
      })

      resetForm()
      setIsAddDialogOpen(false)
    } catch (error) {
      setIsSaving(false)
      const message = error instanceof Error ? error.message : "An unexpected error occurred"
      toast({
        title: "Failed to add staff",
        description: message,
        variant: "destructive",
      })
    }
  }

  const handleEditStaff = async () => {
    if (!editingStaff) return

    const payload = validateForm("edit")
    if (!payload) return

    try {
      const fullName = `${payload.firstName} ${payload.lastName}`
      await updateStaff(editingStaff.uid, {
        firstName: payload.firstName,
        lastName: payload.lastName,
        fullName,
        position: payload.position,
        permissions: formData.permissions,
      })

      toast({
        title: "Staff updated",
        description: `${payload.firstName} ${payload.lastName}'s information has been updated.`,
      })

      resetForm()
      setIsEditDialogOpen(false)
    } catch (error) {
      console.error("[StaffPage] handleEditStaff error:", error)
      toast({
        title: "Failed to update staff",
        description: error instanceof Error ? error.message : "An error occurred. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleOpenEditDialog = (staffMember: StaffAccount) => {
    setEditingStaff(staffMember)
    setFormData({
      firstName: staffMember.firstName || "",
      lastName: staffMember.lastName || "",
      email: staffMember.email || "",
      position: staffMember.position || "",
      password: "",
      status: normalizeStaffStatus(staffMember.status),
      permissions: { ...staffMember.permissions },
    })
    setIsEditDialogOpen(true)
  }

  const handleToggleStatus = async (staffMember: StaffAccount) => {
    const fullName = getFullName(staffMember)
    const normalizedStatus = normalizeStaffStatus(staffMember.status)

    try {
      if (normalizedStatus === "Active") {
        await deactivateStaff(staffMember.uid)
        toast({
          title: "Staff deactivated",
          description: `${fullName} can no longer access staff functions.`,
          variant: "destructive",
        })
      } else {
        await activateStaff(staffMember.uid)
        toast({
          title: "Staff activated",
          description: `${fullName} can access staff functions again.`,
        })
      }
    } catch {
      toast({
        title: "Failed to update status",
        description: "An error occurred. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleDeleteStaff = async (staffMember: StaffAccount) => {
    const fullName = getFullName(staffMember)
    if (!window.confirm(`Delete ${fullName}? This action cannot be undone.`)) return

    try {
      await deleteStaff(staffMember.uid)
      toast({
        title: "Staff deleted",
        description: `${fullName} has been permanently removed.`,
        variant: "destructive",
      })
    } catch (error) {
      toast({
        title: "Failed to delete staff",
        description: error instanceof Error ? error.message : "An error occurred. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleTogglePermission = async (uid: string, permission: keyof StaffPermissions) => {
    try {
      await toggleStaffPermission(uid, permission)
    } catch {
      toast({
        title: "Failed to update permission",
        description: "An error occurred. Please try again.",
        variant: "destructive",
      })
    }
  }

  const renderPermissionsSection = useCallback(
    (prefix: string) => (
      <div className="space-y-3">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
          Module Permissions
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {(Object.keys(PERMISSION_LABELS) as Array<keyof StaffPermissions>).map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-orange-200 hover:bg-orange-50/30 has-[:checked]:border-orange-300 has-[:checked]:bg-orange-50 has-[:checked]:ring-1 has-[:checked]:ring-orange-300"
            >
              <Checkbox
                id={`${prefix}-perm-${key}`}
                checked={formData.permissions[key]}
                onCheckedChange={() => toggleFormPermission(key)}
                className="h-4 w-4 rounded data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
              />
              <span className="text-[11px] font-bold text-slate-700 leading-tight">
                {PERMISSION_LABELS[key]}
              </span>
            </label>
          ))}
        </div>
      </div>
    ),
    [formData.permissions],
  )

  const renderStaffForm = (mode: "add" | "edit") => {
    const prefix = mode === "add" ? "add" : "edit"

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${prefix}-firstName`} className="text-xs font-semibold text-slate-600">
              First Name *
            </Label>
            <Input
              id={`${prefix}-firstName`}
              placeholder="First name"
              value={formData.firstName}
              onChange={(event) => updateForm("firstName", event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${prefix}-lastName`} className="text-xs font-semibold text-slate-600">
              Last Name *
            </Label>
            <Input
              id={`${prefix}-lastName`}
              placeholder="Last name"
              value={formData.lastName}
              onChange={(event) => updateForm("lastName", event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-email`} className="text-xs font-semibold text-slate-600">
            Email *
          </Label>
          <Input
            id={`${prefix}-email`}
            type="email"
            placeholder="staff@example.com"
            value={formData.email}
            onChange={(event) => updateForm("email", event.target.value)}
            className="h-11 rounded-xl"
          />
        </div>

        {mode === "add" && (
          <div className="grid gap-2">
            <Label htmlFor={`${prefix}-password`} className="text-xs font-semibold text-slate-600">
              Temporary Password *
            </Label>
            <Input
              id={`${prefix}-password`}
              type="text"
              placeholder="Minimum 6 characters"
              value={formData.password}
              onChange={(event) => updateForm("password", event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-position`} className="text-xs font-semibold text-slate-600">
            Position *
          </Label>
          <Input
            id={`${prefix}-position`}
            placeholder="e.g., Event Coordinator"
            value={formData.position}
            onChange={(event) => updateForm("position", event.target.value)}
            className="h-11 rounded-xl"
          />
        </div>

        {renderPermissionsSection(prefix)}

        <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-4 py-3.5">
          <p className="flex items-start gap-2 text-xs font-semibold text-amber-800">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Role is automatically set to <b>Staff</b> and cannot be changed from this page.
            </span>
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
<div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
        <div className="flex min-h-[300px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
      <div className="border-b border-slate-200 pb-5 mb-5 flex flex-col gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
            Admin Staff Management
          </p>

          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
            Staff Management
          </h1>

          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
            Add, edit, activate, and deactivate staff accounts for One Estela Place.
          </p>
        </div>

        <Dialog
          open={isAddDialogOpen}
          onOpenChange={(open) => {
            setIsAddDialogOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button className="h-11 rounded-full bg-orange-600 px-6 text-sm font-black text-white shadow-sm hover:bg-orange-700">
              <Plus className="mr-2 h-4 w-4" />
              Add Staff
            </Button>
          </DialogTrigger>

          <DialogContent className="w-[95vw] sm:max-w-[560px] max-h-[90dvh] overflow-y-auto">
            <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
              <DialogTitle className="text-xl font-black text-slate-950">
                Add New Staff
              </DialogTitle>
              <DialogDescription className="text-sm font-medium text-slate-500">
                Create a staff account. Required fields are marked with an asterisk.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5 max-h-[60vh]">
              {renderStaffForm("add")}
            </div>

            <DialogFooter className="shrink-0 px-6 pb-6 pt-2 gap-2 flex-col-reverse sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
                className="rounded-xl font-bold w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddStaff}
                disabled={isSaving}
                className="rounded-xl bg-orange-600 px-5 font-bold text-white hover:bg-orange-700 disabled:opacity-60 w-full sm:w-auto"
              >
                {isSaving ? "Creating..." : "Add Staff"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search staff..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="h-10 rounded-xl border-slate-200 bg-white pl-9 text-xs focus-visible:ring-orange-600 sm:w-[290px]"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as "all" | StaffStatus)}
        >
          <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[170px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>

          <SelectContent className="rounded-xl shadow-xl">
            <SelectItem value="all" className="font-bold">All Status</SelectItem>
            <SelectItem value="Active" className="font-bold">Active</SelectItem>
            <SelectItem value="Inactive" className="font-bold">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {(searchTerm || statusFilter !== "all") && (
          <Button
            variant="outline"
            onClick={() => {
              setSearchTerm("")
              setStatusFilter("all")
            }}
            className="h-10 rounded-xl border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Clear
          </Button>
        )}
      </div>

      {filteredStaff.length > 0 ? (
        <>
          <div className="space-y-3">
            {paginatedStaff.map((staffMember: StaffAccount) => {
              const fullName = getFullName(staffMember)
              const normalizedStatus = normalizeStaffStatus(staffMember.status)
              const grantedCount = Object.values(staffMember.permissions).filter(Boolean).length

              return (
                <div
                  key={staffMember.uid}
                  className="group flex w-full max-w-full min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex shrink-0 items-center gap-3 sm:w-[200px]">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                      <span className="text-sm font-black uppercase">
                        {getInitials(staffMember.firstName, staffMember.lastName)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        Staff
                      </p>
                      <p className="break-words whitespace-normal text-sm font-black text-slate-900">
                        {fullName || "Unnamed Staff"}
                      </p>
                      <p className="break-words whitespace-normal text-[11px] font-bold text-slate-500">
                        {staffMember.position || "No position"}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
                      Email
                    </p>
                    <p className="break-words whitespace-normal text-xs font-black text-slate-800">
                      {staffMember.email}
                    </p>
                    <p className="mt-1 text-[10px] font-semibold text-slate-400">
                      {grantedCount}/{Object.keys(staffMember.permissions).length} modules
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-1">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap ${getStatusBadgeClass(
                        normalizedStatus
                      )}`}
                    >
                      {normalizedStatus}
                    </span>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-2.5 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                        onClick={() => handleOpenEditDialog(staffMember)}
                      >
                        <Edit2 className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                      {normalizedStatus === "Active" ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[10px] font-bold"
                          onClick={() => handleToggleStatus(staffMember)}
                        >
                          <Power className="mr-1 h-3 w-3" />
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-8 shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-2.5 text-[10px] font-bold text-white hover:bg-emerald-700"
                          onClick={() => handleToggleStatus(staffMember)}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" />
                          Activate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[10px] font-bold"
                        onClick={() => handleDeleteStaff(staffMember)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {staffTotalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2 pb-1">
              <Button
                variant="outline"
                disabled={safeStaffPage <= 1}
                onClick={() => setStaffPage((p) => Math.max(1, p - 1))}
                className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </Button>
              <span className="text-xs font-semibold text-slate-500">
                Page {safeStaffPage} of {staffTotalPages}
              </span>
              <Button
                variant="outline"
                disabled={safeStaffPage >= staffTotalPages}
                onClick={() => setStaffPage((p) => Math.min(staffTotalPages, p + 1))}
                className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-[230px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
            <Users className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-black text-slate-700">No staff found</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
            {searchTerm || statusFilter !== "all"
              ? "Try clearing your filters or search keyword."
              : "Add your first staff member to start managing staff accounts."}
          </p>
        </div>
      )}

      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="w-[95vw] sm:max-w-[560px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
            <DialogTitle className="text-xl font-black text-slate-950">Edit Staff</DialogTitle>
            <DialogDescription className="text-sm font-medium text-slate-500">
              Update staff information and permissions.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5 max-h-[60vh]">
            {renderStaffForm("edit")}
          </div>

          <DialogFooter className="shrink-0 px-6 pb-6 pt-2 gap-2 flex-col-reverse sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              className="rounded-xl font-bold w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditStaff}
              className="rounded-xl bg-orange-600 px-5 font-bold text-white hover:bg-orange-700 w-full sm:w-auto"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
