# In Unity's ChatGPT connection

In Unity exposes a read-only, tool-only MCP server at `/mcp` using the official
TypeScript MCP SDK and stateless Streamable HTTP. Each request creates its own
server and verified user context. No OpenAI API key or additional model is needed:
ChatGPT calls the tools and In Unity serves the authorized records.

## Tools

| Tool | Behavior |
| --- | --- |
| `search(query)` | Literal merchant/name/category/item search; up to 20 results per record type, in the standard search format. |
| `fetch(id)` | Selected facts for an owned record, with a canonical source URL. Purchase details include up to 100 receipt line items and an explicit truncation flag. |
| `list_records(kind, query?, cursor?, limit?)` | Exhaustive keyset pagination, at most 50 records per page; follow `nextCursor` until null. |
| `get_spending_summary(from, to, merchant?, category?)` | All matching purchases aggregated in a repeatable-read transaction by currency/category. Inclusive date-only inputs use the account's notification timezone, or UTC if absent. |
| `get_attention_summary()` | Seven calendar days including today: recurring renewals, scheduled bills, return deadlines, and overdue refunds. Each section reports total count and preview truncation. |

Record IDs use `purchase:`, `subscription:`, `return:`, or `bill:` prefixes.
`subscription` reads the canonical `RecurringObligation` model, which can include
other recurring payments. It never reads the retired subscription table.
Amounts are integer minor units. Unknown amounts/currencies stay null. Gross
purchase totals exclude declined/reversed records, retain and count possible
duplicates, and do not subtract refunds. Currency groups are never added together.
Scheduled bill occurrences are existing recorded schedules, not a new cash-flow
forecast, and do not imply that a bill is unpaid. Bills and detected obligations
can overlap. Search/list ordering is by stable record ID, not purchase date.

Tool results exclude raw mailbox content, uploaded receipt files/storage URLs,
credentials, bill account/login identifiers, notes, and precise location. Errors
are masked before the MCP SDK can serialize database diagnostics. Requests are
limited to 32 KiB; personal results use `Cache-Control: no-store`.

## Clerk setup

Use a **dedicated** OAuth application for this MCP resource. Do not repurpose the
existing In Unity OAuth application or change signup/authentication providers.

1. Under In Unity → Configure → Developers → OAuth applications, create the custom
   scope `inunity.read`. Its consent description should say: “Read your In Unity
   purchases, receipt facts, recurring payments, bills and returns, and calculate
   spending and attention summaries.” Advertise this scope for discovery.
2. Create **In Unity for ChatGPT**, a pre-registered public OAuth client. Enable
   PKCE and the consent screen. Assign `inunity.read`, `openid`, `email`, `profile`,
   and `offline_access`. Register only the exact callback URLs supplied by the
   ChatGPT connection; do not add wildcard callbacks. CIMD/DCR are not required
   for this first, pre-registered client integration.
3. Select **opaque access tokens** (disable “Generate access tokens as JWTs” for
   this client). The server deliberately rejects JWTs and introspects opaque
   tokens on every request so Clerk revocation takes effect immediately.
4. Set `INUNITY_MCP_OAUTH_CLIENT_ID` to that client's ID and
   `INUNITY_MCP_OAUTH_ISSUER` to the exact issuer in its discovery metadata
   (production currently `https://clerk.inunity.ca`). Set `APP_URL` to the public
   HTTPS application origin. Missing/invalid configuration returns 503 and
   leaves the connection unavailable.

Clerk's verification endpoint authenticates the token against this instance.
The adapter additionally enforces the dedicated client ID, expiry, revocation,
`inunity.read`, an existing local user, the signup allowlist, and the user's pause.
The current Clerk verification DTO exposes a client ID, not an MCP resource
audience. Therefore this client must be exclusive to this endpoint; never reuse
it for another resource. Before public submission, verify Clerk's handling of
the MCP `resource` parameter in the end-to-end authorization flow against the
current OpenAI requirements. Do not claim audience-claim verification when the
provider does not expose one, or weaken the client/scope checks to get past setup.

OAuth discovery is served at `/.well-known/oauth-protected-resource/mcp` and the
root protected-resource alias. Protocol initialization, ping, and descriptor
listing are public so ChatGPT can discover OAuth-tagged tools before a user
connects. Discovery probes are bounded and strictly JSON-parsed even when the
client omits a JSON Content-Type. Every `tools/call` requires a verified bearer
token; unauthorized tool calls return a bearer challenge before any handler or
user context exists.
The issuer serves its own OAuth/OIDC authorization metadata, authorization-code,
refresh, consent, and revocation endpoints. There is no custom token issuer here.

## User controls

`/settings/connected-agents` describes the shared data and allows immediate pause
or resume. The pause boolean is stored in Clerk private metadata and checked on
every MCP request; no database migration is required. Resuming permits existing
authorized connections again. Disconnect in ChatGPT to remove the connection.
Previously shared conversations follow ChatGPT's own retention/data settings.

## Connect and verify

Run `npm run check`. For a local smoke test, use a development Clerk client and
`APP_URL=http://localhost:3100 npm run dev -- --port 3100`; the OAuth issuer still
uses HTTPS. Check that metadata resolves, `/mcp` without authorization returns a
401 bearer challenge, and ordinary application APIs still require browser auth.
An authenticated GET returns 405 because this server uses POST requests without
a persistent SSE channel.

In ChatGPT, enable Developer mode under Settings → Security and login (subject
to account/workspace availability), open Plugins, and add the deployed HTTPS
`/mcp` endpoint. Configure the pre-registered OAuth client, complete the consent
flow, and inspect the five discovered tools. Start a new conversation and try:

- “Find my receipt for headphones.”
- “What subscriptions am I paying for?”
- “How much did I spend last month?”
- “Which refunds am I waiting for?”
- “Review my In Unity account and tell me what needs attention this week.”

Negative cases: another account's record ID is unavailable; missing/expired/
revoked credentials are rejected; a request to cancel a subscription or pay a bill
has no corresponding tool. Verify pause, resume, disconnect, and reconnect with
two test accounts. Search previews must not be described as complete histories.

Public directory distribution is a separate reviewed submission. Supply publisher
verification, a production endpoint, support/privacy/terms links, demo credentials,
and positive/negative test cases. Approval precedes publication. Refresh developer
connections after tool changes; published metadata requires a new reviewed version.

## Sources

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth)
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Public submission](https://developers.openai.com/plugins/deploy/submission)
- [Clerk OAuth and custom scopes](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
- [Clerk MCP integration](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server)
