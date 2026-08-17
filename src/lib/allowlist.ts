// Signup is OPEN by default. An unset/empty ALLOWED_EMAILS means "no restriction"
// — anyone with a verified email may sign up.
//
// This inverts the original closed-beta behaviour, where an empty list blocked
// every new signup. The env var is now a kill switch rather than the gate:
// setting a list re-closes registration immediately, with no deploy, and revokes
// existing accounts outside it on their next request. That matters because the
// Gmail connection asks for the `gmail.readonly` restricted scope, so the ability
// to shut the door in seconds is worth keeping even while it stands open.
export function hasAllowlist(allowlistCsv: string | undefined): boolean {
  return (allowlistCsv ?? "").split(",").some((e) => e.trim().length > 0);
}

export function isAllowedEmail(
  email: string | null | undefined,
  allowlistCsv: string | undefined,
): boolean {
  if (!email) return false;
  const allowed = (allowlistCsv ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
