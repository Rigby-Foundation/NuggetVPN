"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

type TabsIndicator = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

function Tabs({
                className,
                ...props
              }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
      <TabsPrimitive.Root
          data-slot="tabs"
          className={cn("flex flex-col gap-2", className)}
          {...props}
      />
  )
}

function TabsList({
                    className,
                    children,
                    onKeyDown,
                    onPointerDown,
                    ...props
                  }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const activeTriggerRef = React.useRef<HTMLElement | null>(null)
  const [indicator, setIndicator] = React.useState<TabsIndicator>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false,
  })

  const updateIndicator = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-state="active"]') as HTMLElement | null

    if (resizeObserverRef.current && active !== activeTriggerRef.current) {
      if (activeTriggerRef.current) {
        resizeObserverRef.current.unobserve(activeTriggerRef.current)
      }
      if (active) {
        resizeObserverRef.current.observe(active)
      }
      activeTriggerRef.current = active
    }

    if (!active) {
      setIndicator((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    const listRect = list.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    const next: TabsIndicator = {
      x: Math.round(activeRect.left - listRect.left),
      y: Math.round(activeRect.top - listRect.top),
      width: Math.round(activeRect.width),
      height: Math.round(activeRect.height),
      visible: true,
    }

    setIndicator((prev) =>
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.visible === next.visible
            ? prev
            : next
    )
  }, [])

  React.useLayoutEffect(() => {
    updateIndicator()
  }, [updateIndicator])

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return

    const resizeObserver = new ResizeObserver(() => updateIndicator())
    resizeObserver.observe(list)
    resizeObserverRef.current = resizeObserver

    const mutationObserver = new MutationObserver(() => updateIndicator())
    mutationObserver.observe(list, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    })

    const handleResize = () => updateIndicator()
    window.addEventListener("resize", handleResize)

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", handleResize)
    }
  }, [updateIndicator])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event)
    requestAnimationFrame(updateIndicator)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    requestAnimationFrame(updateIndicator)
  }

  return (
      <TabsPrimitive.List
          data-slot="tabs-list"
          className={cn(
              "relative isolate bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
              className
          )}
          ref={listRef}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          {...props}
      >
        <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-0 rounded-md bg-background shadow-sm transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] opacity-0 dark:bg-input/30"
            style={{
              transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
              width: indicator.width,
              height: indicator.height,
              opacity: indicator.visible ? 1 : 0,
            }}
        />
        {children}
      </TabsPrimitive.List>
  )
}

function TabsTrigger({
                       className,
                       ...props
                     }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
      <TabsPrimitive.Trigger
          data-slot="tabs-trigger"
          className={cn(
              "relative z-10 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-out focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              className
          )}
          {...props}
      />
  )
}

function TabsContent({
                       className,
                       ...props
                     }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
      <TabsPrimitive.Content
          data-slot="tabs-content"
          className={cn("flex-1 outline-none", className)}
          {...props}
      />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
