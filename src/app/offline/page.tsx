export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        MoneyTalks needs a connection for live data — balances, rules and card caps are all
        computed fresh, never served stale. The wallet cheat sheet is worth a screenshot for
        moments like this.
      </p>
    </main>
  );
}
