-- Persist the synchronous Wallet-capture verdict for the authenticated feedback feed.
ALTER TABLE "WalletEvent"
ADD COLUMN "feedbackVerdict" TEXT,
ADD COLUMN "feedbackWarning" TEXT;
