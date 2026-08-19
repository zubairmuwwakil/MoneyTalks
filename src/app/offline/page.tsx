import { WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function OfflinePage() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center p-6 text-center">
      <Card className="max-w-md p-8 shadow-sm">
        <CardContent className="flex flex-col items-center space-y-3 p-0">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-background">
            <WifiOff className="size-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">You are offline</h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Inunity needs an internet connection for live data — balances, rules, and card caps
            are all computed fresh, never served stale.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
