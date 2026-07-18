"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { Card, CardContent } from "@/src/modules/shared/components/ui/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/modules/shared/components/ui/tabs"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import {
  Lock,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react"
import { cn } from "@/src/modules/shared/lib/utils"
import { ProfilePictureUploader } from "@/src/modules/shared/components/profile-picture-uploader"

export default function ProfilePage() {
  const { user, updateProfilePicture, removeProfilePicture } = useAuth()
  const { toast } = useToast()

  const [email, setEmail] = useState(user?.email || "")
  const [phone, setPhone] = useState(user?.phone || "")

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [profilePicture, setPicture] = useState<string | null>(user?.profilePicture ?? null)

  useEffect(() => {
    if (user?.email) setEmail(user.email)
  }, [user?.email])

  useEffect(() => {
    if (!user?.id) {
      setPicture(null)
      return
    }
    setPicture(user.profilePicture || null)
  }, [user?.id, user?.profilePicture])

  if (!user) return null

  const nameParts = user.name ? user.name.trim().split(" ") : [""]
  const firstName = nameParts[0] || ""
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""

  const handleSaveProfile = () => {
    toast({
      title: "Profile Updated",
      description: "Your contact details have been successfully saved.",
    })
  }

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: "Error",
        description: "Please fill in all password fields.",
        variant: "destructive",
      })
      return
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "New password and confirm password do not match.",
        variant: "destructive",
      })
      return
    }
    toast({
      title: "Password Changed",
      description: "Your password has been successfully updated.",
    })
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  const handleProfilePictureChange = async (dataUrl: string | null) => {
    const previousPicture = user?.profilePicture || null
    setPicture(dataUrl)
    try {
      if (dataUrl) {
        await updateProfilePicture(dataUrl)
        toast({
          title: "Profile picture updated",
          description: "Your new photo has been saved.",
        })
      } else {
        await removeProfilePicture()
        toast({
          title: "Profile picture removed",
          description: "Your default avatar is now in use.",
        })
      }
    } catch {
      setPicture(previousPicture)
      toast({
        title: "Error",
        description: dataUrl ? "Failed to upload profile picture. Please try again." : "Failed to remove profile picture. Please try again.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">

        <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-slate-100 bg-white p-5 sm:p-6">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-5 sm:min-w-0">
                <ProfilePictureUploader
                  value={profilePicture || ""}
                  fallbackName={user.name || "Client"}
                  onChange={handleProfilePictureChange}
                  onError={(message) =>
                    toast({
                      title: "Invalid image",
                      description: message,
                      variant: "destructive",
                    })
                  }
                  size="md"
                />

                <div className="text-center sm:text-left">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">
                    Client Account
                  </p>
                  <h2 className="mt-1 break-words text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                    {user.name || "Client"}
                  </h2>
                  <p className="mt-1 break-words text-sm font-medium text-slate-500">
                    {user.email}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2 sm:items-end">
                <div className="flex w-fit items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-700">
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  <span className="text-xs font-black uppercase tracking-[0.2em]">
                    Active Account
                  </span>
                </div>
                <p className="text-[10px] font-semibold text-slate-400">
                  Signed in as a {user.role}
                </p>
              </div>
            </div>
          </div>

          <Tabs defaultValue="personal" className="w-full">
            <div className="border-b border-slate-100 bg-white p-4 sm:p-5">
              <TabsList className="grid h-12 w-full grid-cols-2 rounded-2xl bg-slate-100 p-1">
                <TabsTrigger
                  value="personal"
                  className="rounded-xl text-xs font-black transition-all data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:text-sm"
                >
                  <UserIcon className="mr-2 hidden h-4 w-4 sm:block" />
                  Personal Info
                </TabsTrigger>
                <TabsTrigger
                  value="security"
                  className="rounded-xl text-xs font-black transition-all data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:text-sm"
                >
                  <Lock className="mr-2 hidden h-4 w-4 sm:block" />
                  Security
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="personal" className="m-0">
              <div className="space-y-6 p-5 sm:p-6">
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    Contact Information
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    View and update how One Estela Place can reach you.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FieldWrapper label="First Name">
                    <Input
                      value={firstName}
                      disabled
                      className="h-11 cursor-not-allowed rounded-xl border-slate-200 bg-slate-100 font-medium text-slate-500"
                    />
                  </FieldWrapper>

                  <FieldWrapper label="Last Name">
                    <Input
                      value={lastName}
                      disabled
                      className="h-11 cursor-not-allowed rounded-xl border-slate-200 bg-slate-100 font-medium text-slate-500"
                    />
                  </FieldWrapper>

                  <FieldWrapper label="Email Address">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-11 rounded-xl border-slate-200 pl-10 focus-visible:ring-orange-600"
                      />
                    </div>
                  </FieldWrapper>

                  <FieldWrapper label="Phone Number">
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="tel"
                        placeholder="+63 9xx xxx xxxx"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="h-11 rounded-xl border-slate-200 pl-10 focus-visible:ring-orange-600"
                      />
                    </div>
                  </FieldWrapper>
                </div>

                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <p className="text-xs font-medium leading-6 text-orange-800">
                    Note: Name fields are locked. Contact support for corrections.
                  </p>
                </div>

                <Button
                  onClick={handleSaveProfile}
                  className="h-11 w-full rounded-xl bg-orange-600 px-8 font-bold text-white hover:bg-orange-700 sm:w-auto"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="security" className="m-0">
              <div className="space-y-6 p-5 sm:p-6">
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    Change Password
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Manage your password to keep your account secure.
                  </p>
                </div>

                <div className="max-w-md space-y-4">
                  <FieldWrapper label="Current Password">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="h-11 rounded-xl border-slate-200 focus-visible:ring-orange-600"
                    />
                  </FieldWrapper>

                  <FieldWrapper label="New Password">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 rounded-xl border-slate-200 focus-visible:ring-orange-600"
                    />
                  </FieldWrapper>

                  <FieldWrapper label="Confirm New Password">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 rounded-xl border-slate-200 focus-visible:ring-orange-600"
                    />
                  </FieldWrapper>
                </div>

                <Button
                  onClick={handleChangePassword}
                  className="h-11 w-full rounded-xl bg-slate-900 px-8 font-bold text-white hover:bg-slate-800 sm:w-auto"
                >
                  <Lock className="mr-2 h-4 w-4" />
                  Update Password
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}

function FieldWrapper({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">
        {label}
      </Label>
      {children}
    </div>
  )
}
