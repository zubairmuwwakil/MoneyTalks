import Link from "next/link";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { getSessionAccount } from "@/lib/require-user";
import { mcpConfig } from "@/lib/mcp/config";
import { setAgentAccessPaused } from "./actions";

export default async function ConnectedAgentsPage() {
  const account = await getSessionAccount();
  if (!account) redirect("/login");
  const client = await clerkClient();
  const user = await client.users.getUser(account.clerkId);
  const paused = user.privateMetadata.inunityMcpPaused === true;
  const configured = Boolean(mcpConfig());
  return (
    <main className="max-w-2xl space-y-8 py-8">
      <div className="space-y-2">
        <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Settings</Link>
        <h1 className="text-2xl font-bold tracking-tight">Connected agents</h1>
        <p className="text-sm text-muted-foreground">Let ChatGPT help you understand the records in your In Unity account.</p>
      </div>
      <section className="space-y-4 rounded-xl border p-6">
        <h2 className="font-semibold">In Unity for ChatGPT</h2>
        <p className="text-sm leading-relaxed">After you connect your account and approve read access, ChatGPT can search purchases, receipt facts, recurring payments, saved bills, and returns. It can summarize recorded spending and check the coming week for renewals, return deadlines, and overdue refunds.</p>
        <p className="text-sm leading-relaxed text-muted-foreground">The connection shares relevant records in response to requests. It does not share mailbox credentials, raw emails, receipt files, bill account identifiers, or precise location, and it cannot make changes or payments.</p>
        {configured ? <a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer" className="inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">Open ChatGPT plugins</a> : <p className="text-sm text-muted-foreground">The ChatGPT connection is being set up. It is not available to connect yet.</p>}
        <p className="text-sm text-muted-foreground">Try: “Review my In Unity account and tell me what needs my attention this week.”</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Your access control</h2>
        <p className="text-sm">{paused ? "Agent access is paused. Connected agents cannot read your In Unity records." : "Agent access is available to connections you authorize. This setting alone does not connect an account."}</p>
        <form action={setAgentAccessPaused}>
          <input type="hidden" name="paused" value={paused ? "false" : "true"} />
          <button className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted" type="submit">{paused ? "Resume agent access" : "Pause agent access"}</button>
        </form>
        <p className="text-sm text-muted-foreground">Pausing blocks new requests immediately. Resuming lets existing authorized connections work again. To remove a connection, disconnect In Unity in ChatGPT. Information already shared in a conversation remains subject to ChatGPT’s retention and data settings.</p>
        <Link href="/privacy#connected-agents" className="text-sm underline">How connected agents use your data</Link>
      </section>
    </main>
  );
}
