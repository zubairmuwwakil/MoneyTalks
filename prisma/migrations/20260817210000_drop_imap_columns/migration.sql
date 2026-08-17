-- The scan route was rewired to Gmail REST (getAuthedGmail); the IMAP
-- connection path (getAuthedImap/imapClient.ts) and its settings-page form
-- were removed as dead weight. Verified against prod before authoring this:
-- EmailConnection had 1 row total, 0 with any imap* field set.
ALTER TABLE "EmailConnection"
  DROP COLUMN "imapUser",
  DROP COLUMN "imapPassword",
  DROP COLUMN "imapHost",
  DROP COLUMN "imapPort",
  DROP COLUMN "imapSecure";
