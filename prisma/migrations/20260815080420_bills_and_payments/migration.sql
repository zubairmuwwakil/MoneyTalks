-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "payee" TEXT,
    "sourceAccountId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "variable" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cadence" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "prepaymentMonthDay" TEXT,
    "interestRatePct" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "expectedAmountMinor" INTEGER NOT NULL,
    "actualAmountMinor" INTEGER,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bill_userId_name_key" ON "Bill"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_billId_dueDate_key" ON "Payment"("billId", "dueDate");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
