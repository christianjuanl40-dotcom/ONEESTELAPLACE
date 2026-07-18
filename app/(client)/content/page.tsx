"use client"

import type React from "react"

import { useState } from "react"
import { MainLayout } from "@/components/main-layout"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/src/modules/shared/components/ui/card"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/modules/shared/components/ui/tabs"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { useToast } from "@/src/modules/shared/hooks/use-toast"

export default function ContentPage() {
  const { toast } = useToast()
  const [heroTitle, setHeroTitle] = useState("Welcome to One Estela Place")
  const [heroSubtitle, setHeroSubtitle] = useState("The perfect venue for your special events and business operational needs")
  const [aboutText, setAboutText] = useState(
    "One Estela Place is a premier event venue located in the heart of the city. With stunning architecture and versatile spaces, we provide the perfect setting for weddings, corporate events, and special celebrations.",
  )

  const handleSaveContent = (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Content updated",
      description: "Your changes have been saved successfully",
    })
  }

  const handleSaveImages = (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Images updated",
      description: "Your images have been updated successfully",
    })
  }

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden space-y-6">
        <h1 className="text-3xl font-bold">Content Management</h1>
        <p className="text-muted-foreground">Edit website content and images for the public site.</p>

        <Tabs defaultValue="content">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="content">Text Content</TabsTrigger>
            <TabsTrigger value="images">Images</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="mt-6">
            <Card>
              <form onSubmit={handleSaveContent}>
                <CardHeader>
                  <CardTitle>Edit Website Text</CardTitle>
                  <CardDescription>Make changes to your website content here.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="hero-title" className="text-[10px] font-black uppercase tracking-[0.2em]">Hero Title</Label>
                    <Input id="hero-title" value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} className="h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hero-subtitle" className="text-[10px] font-black uppercase tracking-[0.2em]">Hero Subtitle</Label>
                    <Input id="hero-subtitle" value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} className="h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="about-text" className="text-[10px] font-black uppercase tracking-[0.2em]">About Us Text</Label>
                    <Textarea
                      id="about-text"
                      rows={5}
                      value={aboutText}
                      onChange={(e) => setAboutText(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-info" className="text-[10px] font-black uppercase tracking-[0.2em]">Contact Information</Label>
                    <Textarea id="contact-info" rows={3} placeholder="Enter your contact information" />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit">Save Changes</Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="images" className="mt-6">
            <Card>
              <form onSubmit={handleSaveImages}>
                <CardHeader>
                  <CardTitle>Manage Website Images</CardTitle>
                  <CardDescription>Upload and manage images for your website.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="hero-image" className="text-[10px] font-black uppercase tracking-[0.2em]">Hero Image</Label>
                    <div className="grid gap-4">
                      <div className="h-40 rounded-md border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center">
                        <div className="text-center">
                          <p className="text-sm text-gray-500">Current hero image</p>
                        </div>
                      </div>
                      <Input id="hero-image" type="file" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em]">Gallery Images</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="relative h-24 rounded-md border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center"
                        >
                          <div className="text-center">
                            <p className="text-xs text-gray-500">Image {i}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Input id="gallery-images" type="file" multiple />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit">Save Images</Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  )
}
