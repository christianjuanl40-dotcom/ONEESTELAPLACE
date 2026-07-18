'use client'

import { useCMS } from '@admin/contexts/cms-context'

export interface HomepageContent {
  heroTitle: string
  heroDescription: string
  heroImage: string
  aboutTitle: string
  aboutDescription: string
  ctaText: string
  ctaButtonText: string
  features: Array<{
    id: string
    title: string
    description: string
  }>
}

export interface Venue {
  id: string
  name: string
  description: string
  capacity: number
  images: string[]
  features: string[]
  price: number
  available: boolean
  createdAt: string
  updatedAt: string
}

export interface OfficeRoom {
  id: string
  floor: 'ground' | 'second'
  name: string
  description: string
  capacity: number
  images: string[]
  features: string[]
  available: boolean
  createdAt: string
  updatedAt: string
}

export type VenueContent = Venue
export type OfficeRoomContent = OfficeRoom

export interface ContentDatabase {
  homepage: HomepageContent
  venues: Venue[]
  officeRooms: OfficeRoom[]
  lastUpdated: string
}

export function useHomepageContent() {
  const { homepage, updateHomepage } = useCMS()
  return {
    content: homepage as unknown as HomepageContent | null,
    isLoading: false,
    updateContent: (updates: Partial<HomepageContent>) => {
      updateHomepage(updates as any)
    },
  }
}

export function useVenues() {
  const { venues } = useCMS()
  return {
    venues: venues as Venue[],
    isLoading: false,
  }
}

export function useOfficeRooms() {
  const { offices } = useCMS()
  return {
    rooms: offices as OfficeRoom[],
    isLoading: false,
  }
}

export function useOfficeRoomsByFloor(floor: 'ground' | 'second') {
  const { officeRoomsGround, officeRoomsSecond } = useCMS()
  const rooms = floor === 'ground' ? officeRoomsGround : officeRoomsSecond
  return {
    rooms: rooms as OfficeRoom[],
    isLoading: false,
  }
}

export function useAllContent() {
  const { cmsData } = useCMS()
  return {
    content: {
      homepage: cmsData.homepage as unknown as HomepageContent,
      venues: cmsData.venues as Venue[],
      officeRooms: cmsData.offices as OfficeRoom[],
      lastUpdated: new Date().toISOString(),
    } as ContentDatabase,
    isLoading: false,
  }
}
