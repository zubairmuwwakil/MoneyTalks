#!/usr/bin/env node
// Every guardrail exemption is data with a clock on it. Agents add entries
// self-service so a check never blocks work outright; this fails CI once an
// entry is past its reviewDate, so exemptions cannot silently become permanent.
import { existsSync, readFileSync } from "node:fs";

const REQUIRED = ["id", "check", "path", "why", "owner", "reviewDate"];
const DEFAULT_REGISTRY = "docs/policies/exceptions.json";

function load(registryPath) {
  if (!existsSync(registryPath)) return [];
  const entries = JSON.parse(readFileSync(registryPath, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${registryPath}: expected a JSON array`);

  for (const entry of entries) {
    for (const field of REQUIRED) {
      if (typeof entry?.[field] !== "string" || entry[field].length === 0) {
        throw new Error(`exception ${entry?.id ?? "(no id)"}: missing required field "${field}"`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewDate)) {
      throw new Error(`exception ${entry.id}: reviewDate must be YYYY-MM-DD`);
    }
  }

  return entries;
}

export function findExpiredExceptions(registryPath = DEFAULT_REGISTRY, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10);
  return load(registryPath).filter((entry) => entry.reviewDate < cutoff);
}

export function loadExceptionsFor(checkId, registryPath = DEFAULT_REGISTRY) {
  return load(registryPath)
    .filter((entry) => entry.check === checkId)
    .map((entry) => ({ path: entry.path }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const expired = findExpiredExceptions();
  if (expired.length > 0) {
    console.error("check-policy-exception-expiry: these exemptions are past review:");
    for (const exception of expired) {
      console.error(
        `  ${exception.id} (${exception.check} on ${exception.path}) — due ${exception.reviewDate}, owner ${exception.owner}`,
      );
    }
    console.error("\nRemove the exemption and fix the code, or extend reviewDate with a reason.");
    process.exit(1);
  }
  console.log("check-policy-exception-expiry: no exemption is past review");
}
