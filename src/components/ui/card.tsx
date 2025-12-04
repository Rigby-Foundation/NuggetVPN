import * as React from "react"

import { cn } from "@/lib/utils"
import { Noise } from "./wobble-card"

function Card({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        // БАЗА
        "relative flex flex-col gap-6 rounded-xl border py-6 shadow-sm overflow-hidden",

        // СТЕКЛО
        // backdrop-blur размывает то, что ПОД карточкой (на странице)
        "backdrop-blur-xl",
        // Цвет самого стекла (немного белого)
        "bg-white/10 dark:bg-black/20",
        // Граница-блик
        "border-white/20",

        className
      )}
      {...props}
    >
      {/* 🔥 ИСПРАВЛЕННЫЙ ГРАДИЕНТ (СВЕТЯЩЕЕСЯ ПЯТНО) 
          Мы рисуем круг фиксированного размера в левом верхнем углу и сильно его размываем.
      */}
      {/* <div 
        className="absolute h-full w-full rounded-full bg-orange-500/5 blur-3xl pointer-events-none"
      /> */}

      {/* Если нужно, чтобы градиент был на всю карточку, раскомментируй строку ниже (но пятно выглядит дороже): */}
      {/* <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-orange-500/40 via-transparent to-transparent pointer-events-none" /> */}

      {/* Шум */}
      <Noise opacity={0.05} size="10%" className="absolute inset-0 pointer-events-none opacity-50" />

      {/* КОНТЕНТ
          Важно: z-10 поднимает контент над пятном света
      */}
      <div className="relative z-10 flex flex-col gap-6 h-full">
        {children}
      </div>
    </div>
  )
}

// Остальные компоненты остаются без изменений (Glass styles)
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        "[.border-b]:border-white/10",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold text-white drop-shadow-sm", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-white/80 text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6 text-white/90", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center px-6 [.border-t]:pt-6",
        "[.border-t]:border-white/10",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}