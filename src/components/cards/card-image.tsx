"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { getCardArtworkUrl } from "@/lib/cards/cardArt";
import { getCardBranding } from "@/lib/cards/cardPresentation";
import { CreditCard } from "lucide-react";

export type CardImageSize = "hero" | "tile" | "preview" | "avatar";

export interface CardImageProps {
  contractCardId?: string | null;
  customUrl?: string | null;
  nickname?: string;
  issuer?: string;
  network?: string;
  lastFour?: string | null;
  size?: CardImageSize;
  className?: string;
  priority?: boolean;
}

const SIZE_CONFIGS: Record<CardImageSize, { container: string; isSmall: boolean }> = {
  hero: {
    container: "w-full max-w-[360px] aspect-[1.586/1] rounded-2xl",
    isSmall: false,
  },
  preview: {
    container: "w-full max-w-[320px] aspect-[1.586/1] rounded-xl",
    isSmall: false,
  },
  tile: {
    container: "w-full aspect-[1.586/1] rounded-xl",
    isSmall: false,
  },
  avatar: {
    container: "w-11 h-[28px] shrink-0 rounded-md",
    isSmall: true,
  },
};

export function CardImage({
  contractCardId,
  customUrl,
  nickname = "Credit Card",
  issuer = "",
  network = "VISA",
  lastFour,
  size = "tile",
  className = "",
  priority = false,
}: CardImageProps) {
  const initialUrl = getCardArtworkUrl(contractCardId, customUrl);
  const [currentSrc, setCurrentSrc] = useState<string | null>(initialUrl);
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [fallbackStep, setFallbackStep] = useState(0);

  const branding = getCardBranding(network, issuer, nickname, contractCardId);
  const sizeConfig = SIZE_CONFIGS[size];

  // Sync state whenever card selection changes
  useEffect(() => {
    const nextUrl = getCardArtworkUrl(contractCardId, customUrl);
    setCurrentSrc(nextUrl);
    setHasError(false);
    setIsLoaded(false);
    setFallbackStep(0);
  }, [contractCardId, customUrl]);

  const handleImageError = () => {
    const cardId = contractCardId?.trim().toLowerCase();
    if (!cardId) {
      setHasError(true);
      return;
    }

    if (fallbackStep === 0) {
      // Step 1: try local .webp (real photo)
      setFallbackStep(1);
      setCurrentSrc(`/cards/${cardId}.webp`);
    } else if (fallbackStep === 1) {
      // Step 2: try local .png (real photo)
      setFallbackStep(2);
      setCurrentSrc(`/cards/${cardId}.png`);
    } else if (fallbackStep === 2) {
      // Step 3: try local .svg
      setFallbackStep(3);
      setCurrentSrc(`/cards/${cardId}.svg`);
    } else {
      setHasError(true);
    }
  };

  const canShowImage = Boolean(currentSrc) && !hasError;

  return (
    <div
      className={`relative select-none overflow-hidden shadow-xs border transition-all duration-300 ${sizeConfig.container} ${
        !canShowImage ? `${branding.borderClass} ${branding.bgGradient} bg-card` : "border-border/60 bg-muted/20"
      } ${className}`}
      data-card-id={contractCardId || "custom"}
    >
      {canShowImage && currentSrc ? (
        <>
          <Image
            src={currentSrc}
            alt={nickname || "Credit Card"}
            fill
            unoptimized
            sizes={
              size === "hero"
                ? "(max-width: 768px) 100vw, 360px"
                : size === "avatar"
                ? "44px"
                : "(max-width: 768px) 100vw, 280px"
            }
            priority={priority}
            className={`object-cover object-center transition-opacity duration-300 ${
              isLoaded ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setIsLoaded(true)}
            onError={handleImageError}
          />
          {/* Subtle sheen layer on top of image for physical realism */}
          <div className="absolute inset-0 bg-gradient-to-tr from-black/10 via-transparent to-white/10 pointer-events-none" />
        </>
      ) : null}

      {/* Fallback Display (or loading state before image completes) */}
      {(!canShowImage || !isLoaded) && (
        <div
          className={`absolute inset-0 flex flex-col justify-between p-3 sm:p-4 text-foreground ${
            canShowImage ? "bg-muted/10 animate-pulse" : ""
          }`}
        >
          {sizeConfig.isSmall ? (
            <div className="flex h-full w-full items-center justify-center">
              <CreditCard className="size-4 text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Top Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground line-clamp-1">
                    {issuer || "Card Issuer"}
                  </p>
                  <p className="text-xs font-bold tracking-tight text-foreground line-clamp-1">
                    {nickname || "Payment Card"}
                  </p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-extrabold uppercase tracking-wider ${branding.badgeClass}`}
                >
                  {network}
                </span>
              </div>

              {/* EMV Chip & Waves */}
              <div className="flex items-center gap-2 my-auto">
                <div className="h-5 w-7 rounded-sm bg-gradient-to-br from-amber-300 to-amber-500 border border-amber-600/40 shadow-2xs" />
                <svg className="size-3.5 rotate-90 text-muted-foreground/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M8.5 16.5a5 5 0 0 1 0-9" />
                  <path d="M12 19a8.5 8.5 0 0 1 0-14" />
                </svg>
              </div>

              {/* Bottom Digits */}
              <div className="flex items-end justify-between pt-1">
                <p className="font-mono text-[11px] text-muted-foreground tracking-widest">
                  •••• {lastFour ? lastFour : "••••"}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
