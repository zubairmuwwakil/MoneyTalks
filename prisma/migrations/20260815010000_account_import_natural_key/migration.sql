DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "FinancialAccount"
        GROUP BY "userId", "name", "institution"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce FinancialAccount natural key: duplicate (userId, name, institution) rows exist. Resolve duplicates before deploying this migration.';
    END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_userId_name_institution_key" ON "FinancialAccount"("userId", "name", "institution");
