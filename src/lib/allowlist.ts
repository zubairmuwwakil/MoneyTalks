// An unset/empty ALLOWED_EMAILS means "no allowlist configured": new signups
// are blocked (isAllowedEmail returns false) but existing accounts keep
// working. Enforcement against existing accounts only happens when a list is
// actually configured, so a missing env var can never lock everyone out.
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
