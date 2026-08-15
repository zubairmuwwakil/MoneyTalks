-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_userId_name_institution_key" ON "FinancialAccount"("userId", "name", "institution");
