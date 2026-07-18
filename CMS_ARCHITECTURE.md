# Content Management System (CMS) Architecture

## Overview
The CMS implements a **single source of truth** architecture where both admin/owner and user-facing pages load content from the same persistent data store. Real-time synchronization ensures changes on the admin side are immediately reflected on the user side.

## Architecture Layers

### 1. Data Persistence Layer (`/lib/content-service.ts`)
- **Central Hub**: Manages all content read/write operations
- **Storage**: LocalStorage with structured ContentDatabase
- **Default Data**: Includes sample homepage, venues, and office rooms
- **Event System**: Dispatches 'cms-content-updated' events on any data change

**Key Functions:**
```typescript
// Homepage
getHomepageContent()
updateHomepageContent(updates)

// Venues
getVenues()
getVenueById(id)
addVenue(venue)
updateVenue(id, updates)
deleteVenue(id)

// Office Rooms
getOfficeRooms()
getOfficeRoomsByFloor(floor)
addOfficeRoom(room)
updateOfficeRoom(id, updates)
deleteOfficeRoom(id)

// Global
getAllContent()
resetContent()
```

### 2. Real-time Hooks Layer (`/hooks/use-cms-content.ts`)
- **Auto-sync**: Hooks automatically subscribe to content updates
- **Event Listeners**: Listen for 'cms-content-updated' events
- **Component Integration**: Each component using these hooks gets live updates

**Available Hooks:**
```typescript
useHomepageContent()        // Returns { content, isLoading, updateContent }
useVenues()                 // Returns { venues, isLoading }
useOfficeRooms()            // Returns { rooms, isLoading }
useOfficeRoomsByFloor(floor) // Returns { rooms, isLoading }
useAllContent()             // Returns { content, isLoading }
```

### 3. Context Layer (`/components/cms-context.tsx`)
- **Provider**: Wraps entire app to provide CMS functionality
- **Integration**: Combines all hooks into single context
- **Methods**: Exposes simplified API for component use

**Context Methods:**
```typescript
updateHomepage(updates)     // Update homepage content
addVenue(venue)            // Add new venue
updateVenue(id, updates)   // Update venue
deleteVenue(id)            // Delete venue
addOfficeRoom(room)        // Add office room
updateOfficeRoom(id, updates) // Update room
deleteOfficeRoom(id)       // Delete room
```

### 4. Admin CMS Pages (`/app/dashboard/cms`)
- **Management Page**: Main CMS hub with three tabs
- **Editors**: Specialized components for each content type
- **Real-time Updates**: Immediately persists changes via contentService

**Admin Components:**
- `cms-homepage-editor.tsx` - Edit hero, about, CTA sections
- `cms-venue-editor.tsx` - Manage venues with images
- `cms-office-room-editor.tsx` - Manage office spaces by floor

### 5. User-Facing Pages
- **Homepage** (`/app/page.tsx`) - Loads from contentService
- **Booking System** - Displays venue content dynamically
- **360 Virtual Tour** - Uses contentService for room data
- **All Pages**: Use custom hooks to auto-subscribe to updates

## Data Flow

### Writing (Admin → Storage)
```
Admin CMS Component 
  → contentService.updateVenue() 
  → localStorage updated 
  → 'cms-content-updated' event fired 
  → All subscribed hooks re-fetch data 
  → UI auto-updates
```

### Reading (Storage → User)
```
User Component mounts 
  → useVenues() hook calls contentService.getVenues() 
  → Returns current data from localStorage 
  → Component renders 
  → Hook subscribes to 'cms-content-updated' events 
  → Any admin update triggers re-render
```

## Real-time Synchronization Example

**Scenario: Owner updates venue name in CMS**

1. Admin types new name in CMS and clicks Save
2. `contentService.updateVenue()` updates localStorage
3. CustomEvent 'cms-content-updated' fires with event type 'venues'
4. All `useVenues()` hooks hear the event
5. Hooks call `contentService.getVenues()` to fetch fresh data
6. Component state updates with new venue name
7. Any browser tab/window showing venues auto-refreshes

## Image Handling

Images are stored as URLs in the database:
- **Uploads**: Convert to data URLs or upload to external service
- **Storage**: URLs stored in `images: string[]` array
- **Display**: Load directly from URLs in components

For production, integrate with:
- Vercel Blob
- AWS S3
- Cloudinary
- Firebase Storage

## Data Structures

### HomepageContent
```typescript
{
  heroTitle: string
  heroDescription: string
  heroImage: string
  aboutTitle: string
  aboutDescription: string
  ctaText: string
  ctaButtonText: string
  features: { id, title, description }[]
}
```

### Venue
```typescript
{
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
```

### OfficeRoom
```typescript
{
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
```

## Usage in Components

### Admin Side (CMS)
```typescript
function MyAdminComponent() {
  const { venues, updateVenue } = useCMS()
  
  const handleUpdate = (venueId, newData) => {
    updateVenue(venueId, newData) // Persists and triggers updates
  }
  
  return <div>{/* admin UI */}</div>
}
```

### User Side
```typescript
function VenueCard() {
  const { venues, isLoading } = useVenues()
  
  if (isLoading) return <div>Loading...</div>
  
  return venues.map(venue => (
    <div key={venue.id}>
      <h2>{venue.name}</h2> {/* Auto-updates when admin changes it */}
      <img src={venue.images[0]} />
    </div>
  ))
}
```

## Accessing the CMS

**Admin Dashboard**
- Navigate to: `/dashboard/cms`
- Link in sidebar: "CMS - Content Management"
- Owner access only

**Available Sections**
1. **Homepage Editor** - Edit hero content, about, CTA
2. **Venues Management** - Add/edit/delete venues with images
3. **Office Rooms** - Manage by floor (Ground & Second)

## Database Reset

To reset all content to defaults:
```typescript
contentService.resetContent()
```

This clears localStorage and resets to seed data.

## Migration to Backend

When ready to migrate from localStorage to a backend database:

1. Update `content-service.ts` functions to call API endpoints
2. Keep the same function signatures
3. Replace localStorage calls with API calls
4. Hooks and components remain unchanged

Example migration point:
```typescript
// From
localStorage.getItem(STORAGE_KEY)

// To
const response = await fetch('/api/content')
const data = await response.json()
```
