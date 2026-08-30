"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Home,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HomeOfficeWizardProps {
  onApplyRatio: (ratioPct: number, rationale: string) => void;
  className?: string;
}

export function HomeOfficeWizard({
  onApplyRatio,
  className = "",
}: HomeOfficeWizardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [homeSqFt, setHomeSqFt] = useState<string>("1000");
  const [officeSqFt, setOfficeSqFt] = useState<string>("150");
  const [roomType, setRoomType] = useState<"DEDICATED" | "SHARED">("DEDICATED");
  const [hoursPerWeek, setHoursPerWeek] = useState<string>("40");
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);

  const homeNum = parseFloat(homeSqFt) || 0;
  const officeNum = parseFloat(officeSqFt) || 0;
  const hoursNum = parseFloat(hoursPerWeek) || 40;

  const calculatedRatioPct = useMemo(() => {
    if (homeNum <= 0 || officeNum <= 0) return 0;
    const areaRatio = Math.min(1, officeNum / homeNum);
    if (roomType === "DEDICATED") {
      return Math.round(areaRatio * 100 * 10) / 10;
    } else {
      // Shared area: Area % * (Hours worked / 168 total hours in a week)
      const timeRatio = Math.min(1, hoursNum / 168);
      return Math.round(areaRatio * timeRatio * 100 * 10) / 10;
    }
  }, [homeNum, officeNum, roomType, hoursNum]);

  const handleApply = () => {
    const rationale =
      roomType === "DEDICATED"
        ? `Dedicated Home Office: ${officeNum} sq ft / ${homeNum} sq ft (${calculatedRatioPct}%)`
        : `Shared Workspace: ${officeNum} sq ft / ${homeNum} sq ft @ ${hoursNum} hrs/wk (${calculatedRatioPct}%)`;

    onApplyRatio(calculatedRatioPct, rationale);
    setAppliedMessage(`Applied ${calculatedRatioPct}% workspace ratio to utilities`);
    setTimeout(() => setAppliedMessage(null), 3000);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer"
        >
          <Home className="size-3.5 text-primary" />
          <span>Home Office Square-Footage Calculator</span>
          {isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {appliedMessage ? (
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 animate-fadeIn">
            <Check className="size-3" />
            {appliedMessage}
          </span>
        ) : null}
      </div>

      {isOpen ? (
        <div className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm space-y-4 animate-fadeIn transition-all">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                CRA Workspace-In-The-Home Calculator (T2125 / T777)
              </h3>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">
              CRA Form T2125 Part 7 / Form T777
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            The CRA requires home office utility deductions (electricity, heating, water, internet) to be
            prorated strictly by the proportion of your home used for business.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Total Home Sq Ft */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Total Finished Home Area (sq ft)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="50"
                  step="10"
                  value={homeSqFt}
                  onChange={(e) => setHomeSqFt(e.target.value)}
                  placeholder="e.g. 1200"
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs font-mono"
                />
                <span className="absolute right-2.5 top-1.5 text-[10px] text-muted-foreground">sq ft</span>
              </div>
            </div>

            {/* Office Sq Ft */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Workspace / Office Area (sq ft)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="10"
                  step="5"
                  value={officeSqFt}
                  onChange={(e) => setOfficeSqFt(e.target.value)}
                  placeholder="e.g. 150"
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs font-mono"
                />
                <span className="absolute right-2.5 top-1.5 text-[10px] text-muted-foreground">sq ft</span>
              </div>
            </div>

            {/* Room Type Selection */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Workspace Usage Type
              </label>
              <select
                value={roomType}
                onChange={(e) => setRoomType(e.target.value as "DEDICATED" | "SHARED")}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-2xs cursor-pointer"
              >
                <option value="DEDICATED">Dedicated Office (100% work)</option>
                <option value="SHARED">Common Area (e.g. Dining Table)</option>
              </select>
            </div>
          </div>

          {roomType === "SHARED" ? (
            <div className="pt-1">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Working Hours Per Week (CRA Shared Area Proration)
              </label>
              <div className="relative max-w-40">
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={hoursPerWeek}
                  onChange={(e) => setHoursPerWeek(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs font-mono"
                />
                <span className="absolute right-2.5 top-1.5 text-[10px] text-muted-foreground">hrs / 168</span>
              </div>
            </div>
          ) : null}

          {/* Results Summary Box */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-primary uppercase tracking-wider block">
                Calculated CRA Workspace Ratio
              </span>
              <p className="text-xs text-foreground">
                {officeNum} sq ft of {homeNum} sq ft
                {roomType === "SHARED" ? ` at ${hoursNum} hrs/week` : " (dedicated space)"} ={" "}
                <strong className="font-mono text-primary text-sm">{calculatedRatioPct}%</strong>
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              disabled={calculatedRatioPct <= 0}
              onClick={handleApply}
              className="gap-1 text-xs font-semibold shadow-2xs cursor-pointer shrink-0"
            >
              <Check className="size-3.5" />
              <span>Apply {calculatedRatioPct}% to Utilities</span>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
