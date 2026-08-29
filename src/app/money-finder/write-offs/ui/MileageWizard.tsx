"use client";

import { useState } from "react";
import {
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  calculateMileageAllowance,
  type MileageTrip,
  type MileageCalculationResult,
} from "@/engine/tax-writeoffs/mileageTracker";
import { formatMinorUnits } from "@/engine/money";

interface MileageWizardProps {
  onAddMileageAllowance: (allowanceItem: {
    totalKm: number;
    amountMinor: number;
    notes: string;
  }) => void;
  className?: string;
}

export function MileageWizard({
  onAddMileageAllowance,
  className = "",
}: MileageWizardProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [isOpen, setIsOpen] = useState(false);
  const [isTerritory, setIsTerritory] = useState(false);
  const [trips, setTrips] = useState<MileageTrip[]>([
    {
      id: "trip-1",
      date: today,
      purpose: "Client meeting & site consultation",
      distanceKm: 45,
    },
  ]);

  const [date, setDate] = useState(today);
  const [purpose, setPurpose] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);

  const totalKm = trips.reduce((sum, t) => sum + t.distanceKm, 0);
  const allowance: MileageCalculationResult = calculateMileageAllowance({
    totalBusinessKm: totalKm,
    isTerritory,
  });

  const handleAddTrip = (e: React.FormEvent) => {
    e.preventDefault();
    const km = parseFloat(distanceKm);
    if (!purpose.trim() || isNaN(km) || km <= 0) return;

    const newTrip: MileageTrip = {
      id: `trip-${Date.now()}`,
      date,
      purpose: purpose.trim(),
      distanceKm: km,
    };

    setTrips((prev) => [newTrip, ...prev]);
    setPurpose("");
    setDistanceKm("");
  };

  const handleRemoveTrip = (id: string) => {
    setTrips((prev) => prev.filter((t) => t.id !== id));
  };

  const handleApplyToSummary = () => {
    if (allowance.totalAllowanceMinor <= 0) return;
    onAddMileageAllowance({
      totalKm,
      amountMinor: allowance.totalAllowanceMinor,
      notes: `Vehicle Logbook: ${totalKm} km driven @ CRA prescribed rate ($0.70/km first 5,000 km, $0.64/km thereafter)`,
    });
    setAppliedMessage(`Added ${formatMinorUnits(allowance.totalAllowanceMinor, "CAD")} mileage deduction`);
    setTimeout(() => setAppliedMessage(null), 3500);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer"
        >
          <Car className="size-3.5 text-primary" />
          <span>CRA Automobile Mileage Logbook (70¢/km)</span>
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
              <Car className="size-4 text-primary" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                CRA Statutory Automobile Mileage Allowance
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTerritory}
                  onChange={(e) => setIsTerritory(e.target.checked)}
                  className="rounded accent-primary"
                />
                <span>Territory Rates (74¢/km)</span>
              </label>
              <Badge variant="outline" className="text-[10px] font-mono">
                CRA Line 9281
              </Badge>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            The CRA allows businesses to claim prescribed per-kilometre allowances for business driving (70¢/km
            for first 5,000 km; 64¢/km thereafter) when an audit-ready travel log is maintained.
          </p>

          {/* Add Trip Form */}
          <form onSubmit={handleAddTrip} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-1">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Business Purpose / Client / Destination
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Client consultation at office"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Distance (km)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  placeholder="e.g. 45"
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs font-mono"
                />
                <Button type="submit" size="xs" className="h-8 gap-1 font-semibold text-xs shrink-0 cursor-pointer">
                  <Plus className="size-3.5" />
                  <span>Log</span>
                </Button>
              </div>
            </div>
          </form>

          {/* Trip Log List */}
          {trips.length > 0 ? (
            <div className="rounded-lg border border-border/70 overflow-hidden divide-y divide-border/60 text-xs">
              {trips.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-2.5 hover:bg-muted/20">
                  <div className="space-y-0.5">
                    <span className="font-medium text-foreground block">{t.purpose}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{t.date}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-foreground">{t.distanceKm} km</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTrip(t.id)}
                      className="text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
                      title="Remove trip"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Calculated Allowance Summary Box */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-primary uppercase tracking-wider block">
                Total Business Mileage Allowance ({allowance.totalBusinessKm} km)
              </span>
              <p className="text-xs text-foreground">
                First 5,000 km ({allowance.tier1Km} km @ ${(allowance.tier1Rate).toFixed(2)}/km)
                {allowance.tier2Km > 0 ? ` + Excess (${allowance.tier2Km} km @ $${allowance.tier2Rate.toFixed(2)}/km)` : ""} ={" "}
                <strong className="font-mono text-primary text-sm font-bold">
                  {formatMinorUnits(allowance.totalAllowanceMinor, "CAD")}
                </strong>
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              disabled={allowance.totalAllowanceMinor <= 0}
              onClick={handleApplyToSummary}
              className="gap-1 text-xs font-semibold shadow-2xs cursor-pointer shrink-0"
            >
              <Check className="size-3.5" />
              <span>Add to Write-Offs</span>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
