'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { XIcon } from 'lucide-react'

import { cn } from '@shared/lib/utils'

function hasChildType(children: React.ReactNode, type: React.ElementType): boolean {
  let found = false
  React.Children.forEach(children, (child) => {
    if (found || !React.isValidElement(child)) return
    if (child.type === type) {
      found = true
      return
    }
    const childProps = child.props as { children?: React.ReactNode }
    if (childProps?.children) {
      if (hasChildType(childProps.children, type)) found = true
    }
  })
  return found
}

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

const DialogTrigger = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>>(function DialogTrigger({
  ...props
}, ref) {
  return <DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" {...props} />
})

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

const DialogClose = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Close>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>>(function DialogClose({
  ...props
}, ref) {
  return <DialogPrimitive.Close ref={ref} data-slot="dialog-close" {...props} />
})

const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(function DialogOverlay({
  className,
  ...props
}, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[10001] bg-black/60',
        className,
      )}
      {...props}
    />
  )
})

const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  plain?: boolean
}>(function DialogContent({
  className,
  children,
  showCloseButton = true,
  plain,
  ...props
}, ref) {
  // Radix's modal overlay owns the reference-counted scroll lock. A separate
  // body-overflow effect here also runs for closed, mounted DialogContent and
  // restores stale values when nested dialogs close in a different order.
  const hasTitle = hasChildType(children, DialogTitle)
  const hasDescription = hasChildType(children, DialogDescription)
  const needsA11yFallback = !hasTitle || !hasDescription

  const a11yFallback = needsA11yFallback ? (
    <VisuallyHidden.Root>
      {!hasTitle && <DialogTitle>Dialog</DialogTitle>}
      {!hasDescription && (
        <DialogDescription>This dialog contains important information.</DialogDescription>
      )}
    </VisuallyHidden.Root>
  ) : null

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          'fixed left-[50%] top-[50%] z-[10002] w-full max-w-[calc(100vw-32px)] translate-x-[-50%] translate-y-[-50%]',
          !plain && 'flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col',
          className,
        )}
        {...props}
      >
        {plain ? (
          <>
            {children}
            {a11yFallback}
          </>
        ) : (
          <div data-slot="dialog-surface" className="oe-light-surface relative flex max-h-[inherit] min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
            {children}
            {a11yFallback}
            {showCloseButton && (
              <DialogPrimitive.Close
                data-slot="dialog-close"
                className="ring-offset-background focus:ring-ring absolute top-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
              >
                <XIcon className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(function DialogTitle({
  className,
  ...props
}, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-bold', className)}
      {...props}
    />
  )
})

const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(function DialogDescription({
  className,
  ...props
}, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      data-slot="dialog-description"
      className={cn('text-sm font-normal', className)}
      {...props}
    />
  )
})

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
