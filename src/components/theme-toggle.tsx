"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Laptop } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("inunity-theme") as Theme | null;
    if (stored && ["light", "dark", "system"].includes(stored)) {
      setTheme(stored);
      applyTheme(stored);
    } else {
      applyTheme("system");
    }
  }, []);

  function applyTheme(nextTheme: Theme) {
    const root = document.documentElement;
    const isDark =
      nextTheme === "dark" ||
      (nextTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }

  function cycleTheme() {
    const next: Theme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(next);
    localStorage.setItem("inunity-theme", next);
    applyTheme(next);
  }

  if (!mounted) {
    return (
      <div
        className={cn(
          "flex size-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground",
          className
        )}
      >
        <Sun className="size-4 opacity-50" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer",
        className
      )}
      title={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)} (click to cycle)`}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <Moon className="size-4 text-sky-400" />
      ) : theme === "light" ? (
        <Sun className="size-4 text-amber-500" />
      ) : (
        <Laptop className="size-4" />
      )}
    </button>
  );
}
