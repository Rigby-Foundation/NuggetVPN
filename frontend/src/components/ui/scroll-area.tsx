"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

function ScrollArea({
                      className,
                      children,
                      viewportRef,
                      fadeEdges = false,
                      ...props
                    }: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
                      /** The element that actually scrolls. */
                      viewportRef?: React.Ref<HTMLDivElement>
                      /** Fade content only at edges with more content to scroll to. */
                      fadeEdges?: boolean
                    }) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ top: false, bottom: false })
  const setViewport = React.useCallback((element: HTMLDivElement | null) => {
    viewport.current = element
    if (typeof viewportRef === "function") return viewportRef(element)
    if (viewportRef) viewportRef.current = element
  }, [viewportRef])

  React.useEffect(() => {
    const element = viewport.current
    if (!fadeEdges || !element) return

    const update = () => {
      const top = element.scrollTop > 1
      const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 1
      setEdges((current) => current.top === top && current.bottom === bottom ? current : { top, bottom })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    element.addEventListener("scroll", update, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener("scroll", update)
    }
  }, [fadeEdges])

  return (
      <ScrollAreaPrimitive.Root
          data-slot="scroll-area"
          className={cn("relative overflow-hidden", className)}
          {...props}
      >
        <ScrollAreaPrimitive.Viewport
            ref={setViewport}
            data-slot="scroll-area-viewport"
            className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&>div]:!block"
            style={fadeEdges ? {
              maskImage: `linear-gradient(to bottom, ${edges.top ? "transparent" : "black"}, black 12px, black calc(100% - 12px), ${edges.bottom ? "transparent" : "black"})`,
            } : undefined}
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
                     className,
                     orientation = "vertical",
                     ...props
                   }: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
      <ScrollAreaPrimitive.ScrollAreaScrollbar
          data-slot="scroll-area-scrollbar"
          orientation={orientation}
          className={cn(
              "flex touch-none p-px transition-colors select-none",
              orientation === "vertical" &&
              "h-full w-2 border-l border-l-transparent",
              orientation === "horizontal" &&
              "h-2 flex-col border-t border-t-transparent",
              className
          )}
          {...props}
      >
        <ScrollAreaPrimitive.ScrollAreaThumb
            data-slot="scroll-area-thumb"
            className="bg-border relative flex-1 rounded-full"
        />
      </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
