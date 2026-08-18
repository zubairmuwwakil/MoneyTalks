"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/utils/calendarEvents";
import { toISODateOnlyUTC } from "@/lib/utils/dates";
import { addMonthsUTC, buildMonthGrid, gridRangeISO, startOfMonthUTC, type CalendarCell } from "@/lib/domain/calendar/monthGrid";
import { eventHref, eventTreatment, type EventTreatment } from "@/lib/domain/calendar/eventPresentation";

/**
 * Pure consumer of GET /api/events — no prisma import here, ever. Any
 * calendar source added to that route (a fifth product surface, say)
 * appears on this page without a single line changing here. See §8.3 of
 * the calendar spec.
 */

const MONTH_TITLE = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS_PER_CELL = 3;

// Keyed by the same EventTreatment values eventTreatment() returns, which
// are themselves Badge variant names — so this is the one place a
// treatment maps to a raw color, purely for the grid's small dots.
const DOT_CLASS: Record<EventTreatment, string> = {
  destructive: "bg-red-500 dark:bg-red-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  success: "bg-emerald-500 dark:bg-emerald-400",
  info: "bg-sky-500 dark:bg-sky-400",
  muted: "bg-slate-400 dark:bg-slate-500",
};

type LoadState = "loading" | "ready" | "error";

function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.date);
    if (list) list.push(ev);
    else map.set(ev.date, [ev]);
  }
  return map;
}

function MonthGridView({
  cells,
  eventsByDate,
  todayISO,
}: {
  cells: CalendarCell[];
  eventsByDate: Map<string, CalendarEvent[]>;
  todayISO: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const iso = toISODateOnlyUTC(cell.date);
          const dayEvents = eventsByDate.get(iso) ?? [];
          const isToday = iso === todayISO;
          const isLastColumn = i % 7 === 6;
          const isLastRow = i >= cells.length - 7;

          return (
            <div
              key={iso}
              className={cn(
                "min-h-24 p-1.5 sm:min-h-28",
                !isLastColumn && "border-r border-border/60",
                !isLastRow && "border-b border-border/60",
                !cell.inMonth && "bg-muted/10",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums",
                  !cell.inMonth && "text-muted-foreground/40",
                  cell.inMonth && !isToday && "text-foreground/80",
                  isToday && "bg-foreground font-semibold text-background",
                )}
              >
                {cell.date.getUTCDate()}
              </span>

              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, MAX_CHIPS_PER_CELL).map((ev) => (
                  <Link
                    key={ev.id}
                    href={eventHref(ev)}
                    title={ev.title}
                    className={cn(
                      "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight hover:bg-muted/60",
                      ev.estimated && "italic text-muted-foreground",
                    )}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[eventTreatment(ev)])} />
                    <span className="truncate">{ev.title}</span>
                  </Link>
                ))}
                {dayEvents.length > MAX_CHIPS_PER_CELL ? (
                  <p className="px-1 text-[10px] text-muted-foreground">
                    +{dayEvents.length - MAX_CHIPS_PER_CELL} more
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CalendarClient() {
  // Both start null and resolve on mount rather than from `new Date()`
  // directly in render — the same "loads data after mount" shape every
  // other client board in this app already uses (see the repo-wide
  // react-hooks/set-state-in-effect override in eslint.config.mjs), and it
  // sidesteps a server/client hydration mismatch across a midnight or
  // month boundary.
  const [monthStart, setMonthStart] = useState<Date | null>(null);
  const [todayISO, setTodayISO] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    const now = new Date();
    setMonthStart(startOfMonthUTC(now));
    setTodayISO(toISODateOnlyUTC(now));
  }, []);

  useEffect(() => {
    if (!monthStart) return;
    let cancelled = false;
    setState("loading");

    const { start, end } = gridRangeISO(monthStart);
    fetch(`/api/events?start=${start}&end=${end}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: { events: CalendarEvent[] }) => {
        if (cancelled) return;
        setEvents(data.events ?? []);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [monthStart]);

  const cells = useMemo(() => (monthStart ? buildMonthGrid(monthStart) : []), [monthStart]);
  const eventsByDate = useMemo(() => groupByDate(events), [events]);

  if (!monthStart || !todayISO) {
    return <div className="h-64 animate-pulse rounded-xl border border-border/80 bg-muted/20" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight tabular-nums">{MONTH_TITLE.format(monthStart)}</h2>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => setMonthStart((m) => addMonthsUTC(m!, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonthStart(startOfMonthUTC(new Date()))}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => setMonthStart((m) => addMonthsUTC(m!, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {state === "error" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          Couldn&apos;t load the calendar. Try again in a moment.
        </p>
      ) : (
        <>
          <MonthGridView cells={cells} eventsByDate={eventsByDate} todayISO={todayISO} />
          <p className="text-xs text-muted-foreground">
            {state === "loading" ? "Loading…" : `${events.length} event${events.length === 1 ? "" : "s"} in view.`}
          </p>
        </>
      )}
    </div>
  );
}
