# Separate database migrations from application builds

**Status:** Ratified 2026-08-30

## Decision

`npm run build` performs only the Next.js production build. Database migrations
run separately with `npm run db:migrate:deploy`, using `DIRECT_URL` when the
runtime `DATABASE_URL` is a pooled Postgres connection. Agents must not add
migrations back into the build command.

## Reason

Application instances can scale horizontally and roll out concurrently. A build
should be reproducible and safe to run on every instance; schema ownership
belongs to one ordered release step, not to whichever instance happens to build
first. This also makes expand/contract migrations possible without coupling
availability to application startup.

## Operational sequence

1. Apply the compatible migration with `npm run db:migrate:deploy`.
2. Deploy/build the application with `npm run build`.
3. Roll back application code without attempting to roll back the database
   automatically; migrations remain forward-compatible and deliberate.
