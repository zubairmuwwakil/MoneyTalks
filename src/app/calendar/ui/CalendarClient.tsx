"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/lib/utils/calendarEvents";
import { toISODateOnlyUTC } from "@/lib/utils/dates";
import { addMonthsUTC, gridRangeISO, startOfMonthUTC } from "@/lib/domain/calendar/monthGrid";

/**
 * Pure consumer of GET /api/events — no prisma import here, ever. Any
 * calendar source added to that route (a fifth product surface, say)
 * appears on this page without a single line changing here. See §8.3 of
 * the calendar spec.
 */

const MONTH_TITLE = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });

type LoadState = "loading" | "ready" | "error";

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
        <p className="text-xs text-muted-foreground">
          {state === "loading" ? "Loading…" : `${events.length} event${events.length === 1 ? "" : "s"} in view.`}
        </p>
      )}
    </div>
  );
}
