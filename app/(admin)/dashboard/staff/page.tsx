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
import { useToast } from "@shared/hooks/use-toast"
import { Checkbox } from "@shared/components/ui/checkbox"
import { Edit2, Plus, Search, ShieldCheck, Users, Trash2 } from "lucide-react"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@shared/components/ui/table"
import { formatBookingDateTime } from "@/src/modules/shared/lib/booking-helpers"
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

function getStaffStatusClass(status?: string) {
  return normalizeStaffStatus(status) === "Active"
    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-600"
}

function formatStaffDate(value?: string) {
  return value ? formatBookingDateTime(value, "short") || "—" : "—"
}

export default function StaffManagementPage() {
  const { user } = useAuth()
  const router = useRouter()
  const {
    staff,
    loading,
    addStaff,
    updateStaff,
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
  const [formData, setFormData] = useState<StaffFormData>(DEFAULT_FORM)
  const [staffPage, setStaffPage] = useState(1)
  const STAFF_PER_PAGE = 10

  const filteredStaff = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    return staff
      .filter((staffMember: StaffAccount) => {
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

        return matchesSearch
      })
      .sort((a: StaffAccount, b: StaffAccount) => {
        const statusA = normalizeStaffStatus(a.status)
        const statusB = normalizeStaffStatus(b.status)

        if (statusA !== statusB) return statusA === "Active" ? -1 : 1
        return getFullName(a).localeCompare(getFullName(b))
      })
  }, [staff, searchTerm])

  useEffect(() => {
    setStaffPage(1)
  }, [searchTerm])

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
        <p className="text-xs font-black uppercase tracking-[0.2em] text-black">
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
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-500">Loading staff accounts…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="oe-page-title">Staff Management</h1>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
          <Dialog
            open={isAddDialogOpen}
            onOpenChange={(open) => {
              setIsAddDialogOpen(open)
              if (!open) resetForm()
            }}
          >
            <DialogTrigger asChild>
              <Button variant="brand" className="h-10 rounded-full px-6 text-sm font-black shadow-sm">
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

          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              placeholder="Search staff..."
              aria-label="Search staff accounts"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="h-10 rounded-xl border-slate-200 bg-white pl-9 text-xs focus-visible:ring-orange-600 sm:w-[290px]"
            />
          </div>
        </div>
      </header>

      {filteredStaff.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <Table className="min-w-[900px] table-fixed xl:min-w-0">
              <caption className="sr-only">Staff accounts and module permissions</caption>
              <colgroup>
                <col style={{ width: "25%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <TableHeader className="bg-slate-50/80">
                <tr>
                  <TableHead className="oe-table-head">Staff member</TableHead>
                  <TableHead className="oe-table-head">Email / joined</TableHead>
                  <TableHead className="oe-table-head">Status</TableHead>
                  <TableHead className="oe-table-head">Access</TableHead>
                  <TableHead className="oe-table-head text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {paginatedStaff.map((staffMember: StaffAccount) => {
                  const fullName = getFullName(staffMember)
                  const grantedCount = Object.values(staffMember.permissions).filter(Boolean).length

                  return (
                    <tr key={staffMember.uid} className="border-b border-slate-100 transition-colors hover:bg-slate-50/70">
                      <TableCell className="min-w-0 align-top whitespace-normal">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar
                            name={fullName}
                            picture={staffMember.profilePicture}
                            className="h-10 w-10 shrink-0"
                            ringClassName=""
                            fallbackClassName="bg-orange-50 text-orange-600"
                            textClassName="text-sm font-black uppercase"
                          />
                          <div className="min-w-0">
                            <p className="oe-table-primary line-clamp-2">{fullName || "Unnamed Staff"}</p>
                            <p className="oe-table-secondary mt-0.5 line-clamp-1">{staffMember.position || "No position"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 align-top whitespace-normal">
                        <p className="oe-table-primary break-words">{staffMember.email || "—"}</p>
                        <p className="oe-table-secondary mt-0.5">Joined {formatStaffDate(staffMember.createdAt)}</p>
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap">
                        <span className={`oe-status-badge border ${getStaffStatusClass(staffMember.status)}`}>
                          {normalizeStaffStatus(staffMember.status)}
                        </span>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <p className="oe-table-primary">{grantedCount}/{Object.keys(staffMember.permissions).length} modules</p>
                        <p className="oe-table-secondary mt-0.5">Permissions can be changed in Edit.</p>
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap text-right">
                        <div className="oe-table-actions">
                          <Button
                            variant="outline"
                            size="sm"
                            className="oe-table-action h-9 min-w-[78px] whitespace-nowrap border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => handleOpenEditDialog(staffMember)}
                          >
                            <Edit2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            aria-label={`Delete ${fullName || "staff member"}`}
                            title={`Delete ${fullName || "staff member"}`}
                            className="oe-table-action h-9 min-w-[78px] whitespace-nowrap px-2.5 text-xs"
                            onClick={() => handleDeleteStaff(staffMember)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </tr>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2 md:hidden">
            {paginatedStaff.map((staffMember: StaffAccount) => {
              const fullName = getFullName(staffMember)
              const grantedCount = Object.values(staffMember.permissions).filter(Boolean).length

              return (
                <article
                  key={staffMember.uid}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar
                        name={fullName}
                        picture={staffMember.profilePicture}
                        className="h-10 w-10 shrink-0"
                        ringClassName=""
                        fallbackClassName="bg-orange-50 text-orange-600"
                        textClassName="text-sm font-black uppercase"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="oe-table-primary line-clamp-2">{fullName || "Unnamed Staff"}</p>
                        <p className="oe-table-secondary mt-0.5 line-clamp-1">{staffMember.position || "No position"}</p>
                      </div>
                    </div>
                    <span className={`oe-status-badge shrink-0 border ${getStaffStatusClass(staffMember.status)}`}>
                      {normalizeStaffStatus(staffMember.status)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
                    <div className="min-w-0">
                      <dt className="oe-table-label">Email</dt>
                      <dd className="oe-table-secondary mt-0.5 break-words">{staffMember.email || "—"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="oe-table-label">Joined</dt>
                      <dd className="oe-table-secondary mt-0.5">{formatStaffDate(staffMember.createdAt)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="oe-table-label">Access</dt>
                      <dd className="oe-table-secondary mt-0.5">{grantedCount}/{Object.keys(staffMember.permissions).length} modules</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    <Button
                      variant="outline"
                      className="h-10 flex-1 rounded-lg border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      onClick={() => handleOpenEditDialog(staffMember)}
                    >
                      <Edit2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      aria-label={`Delete ${fullName || "staff member"}`}
                      className="h-10 flex-1 rounded-lg text-xs font-bold"
                      onClick={() => handleDeleteStaff(staffMember)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </article>
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
            {searchTerm
              ? "Try clearing your search keyword."
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
