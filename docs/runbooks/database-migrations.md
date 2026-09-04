# Runbook — database migrations

**Read when:** creating, checking, or applying a Prisma migration.
**Canonical commands:** `npm run db:status` and `npm run db:migrate:deploy`.

This is the operational procedure. Feature plans and deployment handoffs may add
feature-specific verification or a temporary safety block, but they must route
back here rather than inventing a different migration process.

## Connection model

In Unity normally has two URLs for the same production Neon database branch:

- `DATABASE_URL` is the pooled runtime URL used by the deployed application.
- `DIRECT_URL` is the matching non-pooled URL used by Prisma migration commands.

`prisma.config.ts` loads `.env.local` automatically and chooses `DIRECT_URL` when
present, otherwise `DATABASE_URL`. Vercel does not need `DIRECT_URL` merely to run
the application; the environment that executes the release migration does. Never
put either URL in source control, documentation, chat, or command output.

For Neon, the pooled and direct hosts normally differ only by `-pooler`. Matching
that normalized host is necessary, but also confirm the database name and the
linked Vercel project. A Neon account's display name is not the database target.

## Check and deploy production migrations

1. Preserve unrelated local work. Fetch GitHub and determine whether `main` is
   behind. Before pulling a dirty checkout, confirm incoming paths do not overlap
   local edits. Use a fast-forward-only pull.

2. Confirm `.vercel/project.json` links this checkout to the In Unity project
   (`money-talks`). Confirm its production `DATABASE_URL` and `.env.local`'s
   `DIRECT_URL` describe the same Neon endpoint, database, and user after removing
   only Neon's `-pooler` hostname marker. Inspect parsed host metadata only; never
   print a full URL.

   `vercel env pull` may redact encrypted secrets. That is not evidence that the
   database is missing. If it returns the production `DATABASE_URL`, compare its
   safe metadata with the local direct URL. If it redacts the value, verify the
   endpoint in the Vercel dashboard or another owner-approved secret store. Do not
   overwrite `.env.local`; pull into a temporary file and delete it immediately.

3. Run the read-only status check:

   ```bash
   npm run db:status
   ```

   Prisma prints the selected host and database without the password. Confirm it
   is the direct member of the verified production pair. Record the exact pending
   migration directories; do not treat a newly pulled SQL file as already applied.

4. If migrations are pending and the target is verified, apply them once from
   this operator/release environment:

   ```bash
   npm run db:migrate:deploy
   ```

   Agents are pre-authorized by `AGENTS.md` to run this command when these checks
   pass. Do not ask again, run raw migration SQL, use `prisma migrate dev` against
   production, or couple migration execution to a Vercel application build.

5. Verify the result:

   ```bash
   npm run db:status
   npm run check
   ```

   Status must say the schema is up to date. Then perform any feature-specific
   smoke test named by the migration's handoff or design.

## Local schema development

Use `npx prisma migrate dev --name <descriptive-name>` only with a disposable or
local development database. Review the generated SQL, keep migrations additive
and forward-compatible with the currently deployed application, and commit the
schema change and migration together. Production rollback means rolling back
application code while leaving compatible schema in place; never automatically
reverse or delete an applied migration.

## Stop conditions

Do not write when the direct and pooled URLs resolve to different endpoint pairs,
the linked Vercel project is not In Unity, the database/user cannot be verified,
or a feature handoff names a still-unresolved safety constraint. Report exactly
which check failed and what owner-controlled value is needed. A missing
`DIRECT_URL` in Vercel alone is not a stop condition when the release environment
has a verified matching direct URL.
