-- CreateEnum
CREATE TYPE "SubscriptionCadence" AS ENUM ('MONTHLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DetectedItemType" AS ENUM ('TRIAL', 'RENEWAL', 'BILL');

-- CreateEnum
CREATE TYPE "DetectedItemStatus" AS ENUM ('NEW', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('NOT_STARTED', 'PACKED', 'DROPPED_OFF', 'DELIVERED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ValueEventType" AS ENUM ('AVOIDED_RENEWAL', 'REFUND_RECEIVED', 'FEE_AVOIDED');

-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'UPLOAD');

-- CreateEnum
CREATE TYPE "PurchaseSource" AS ENUM ('GMAIL', 'UPLOAD', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('ALL', 'RECEIPTS_ONLY', 'SHIPPING_ONLY', 'SUBSCRIPTIONS_ONLY');

-- CreateEnum
CREATE TYPE "DataDeletionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReceiptUploadStatus" AS ENUM ('PARSED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'CONFIRMED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('RETURN', 'SUBSCRIPTION', 'BILL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SUBSCRIPTION_RENEWAL_SOON', 'RETURN_DEADLINE_SOON', 'BILL_DUE_SOON', 'REFUND_CHECK_DUE', 'REFUND_OVERDUE', 'RETURN_DELIVERED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL_DIGEST', 'EMAIL_IMMEDIATE');

-- CreateEnum
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "renewalDate" TIMESTAMP(3) NOT NULL,
    "cadence" "SubscriptionCadence" NOT NULL DEFAULT 'MONTHLY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelUrl" TEXT,
    "notes" TEXT,
    "trialEndAt" TIMESTAMP(3),
    "cancelInstructions" TEXT,
    "merchantCanonicalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "store" TEXT NOT NULL,
    "itemNote" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "returnWindowDays" INTEGER NOT NULL DEFAULT 30,
    "returnBy" TIMESTAMP(3) NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "dropoffDate" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "refundExpectedAt" TIMESTAMP(3),
    "refundedDate" TIMESTAMP(3),
    "refundAmountCents" INTEGER,
    "refundSlaDays" INTEGER NOT NULL DEFAULT 14,
    "refundType" TEXT DEFAULT 'ORIGINAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnoozedEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnoozedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" "ReceiptUploadStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "extracted" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "totalCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "orderNumber" TEXT,
    "paymentMethod" TEXT,
    "source" "PurchaseSource" NOT NULL DEFAULT 'GMAIL',
    "sourceEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "qty" INTEGER,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CAD',

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseAttachment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT,
    "sha256" TEXT,
    "sourceEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL DEFAULT 'GMAIL',
    "emailAddress" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiry" TIMESTAMP(3),
    "scope" TEXT,
    "lastScanAt" TIMESTAMP(3),
    "scanMode" "ScanMode" NOT NULL DEFAULT 'ALL',
    "imapUser" TEXT,
    "imapPassword" TEXT,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapSecure" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataDeletionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DataDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "DataDeletionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL DEFAULT 'GMAIL',
    "primaryMessageId" TEXT,
    "type" "SuggestionType" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "merchant" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "detectedDate" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "messageIds" JSONB NOT NULL,
    "draft" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DetectedItemType" NOT NULL,
    "merchant" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "date" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL,
    "sourceEmailId" TEXT,
    "rawSnippetHash" TEXT NOT NULL,
    "status" "DetectedItemStatus" NOT NULL DEFAULT 'NEW',
    "subscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL DEFAULT 'GMAIL',
    "messageId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "fromEmail" TEXT,
    "subject" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "totalCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "items" JSONB,
    "rawSource" TEXT NOT NULL,
    "parserError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailTransactionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "eventDate" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "sendAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockId" TEXT,
    "notificationId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "emailDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "digestHourLocal" INTEGER NOT NULL DEFAULT 9,
    "windowDays" INTEGER NOT NULL DEFAULT 14,
    "subLeadDays" INTEGER NOT NULL DEFAULT 3,
    "returnLeadDays" INTEGER NOT NULL DEFAULT 2,
    "billLeadDays" INTEGER NOT NULL DEFAULT 2,
    "primaryEmail" TEXT,
    "notifyOnDelivery" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnRefundOverdue" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL,
    "statusText" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "refundType" TEXT DEFAULT 'ORIGINAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValueEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ValueEventType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_userId_renewalDate_idx" ON "Subscription"("userId", "renewalDate");

-- CreateIndex
CREATE INDEX "ReturnItem_userId_returnBy_idx" ON "ReturnItem"("userId", "returnBy");

-- CreateIndex
CREATE INDEX "ReturnItem_userId_refundExpectedAt_idx" ON "ReturnItem"("userId", "refundExpectedAt");

-- CreateIndex
CREATE INDEX "SnoozedEvent_userId_snoozedUntil_idx" ON "SnoozedEvent"("userId", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SnoozedEvent_userId_eventId_key" ON "SnoozedEvent"("userId", "eventId");

-- CreateIndex
CREATE INDEX "ReceiptUpload_userId_createdAt_idx" ON "ReceiptUpload"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_userId_purchasedAt_idx" ON "Purchase"("userId", "purchasedAt");

-- CreateIndex
CREATE INDEX "Purchase_userId_merchant_idx" ON "Purchase"("userId", "merchant");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_userId_sourceEmailId_key" ON "Purchase"("userId", "sourceEmailId");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseAttachment_purchaseId_idx" ON "PurchaseAttachment"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAttachment_purchaseId_storageKey_key" ON "PurchaseAttachment"("purchaseId", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConnection_userId_key" ON "EmailConnection"("userId");

-- CreateIndex
CREATE INDEX "DataDeletionJob_userId_status_idx" ON "DataDeletionJob"("userId", "status");

-- CreateIndex
CREATE INDEX "AutomationSuggestion_userId_status_idx" ON "AutomationSuggestion"("userId", "status");

-- CreateIndex
CREATE INDEX "AutomationSuggestion_userId_type_idx" ON "AutomationSuggestion"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationSuggestion_userId_primaryMessageId_key" ON "AutomationSuggestion"("userId", "primaryMessageId");

-- CreateIndex
CREATE INDEX "DetectedItem_userId_status_idx" ON "DetectedItem"("userId", "status");

-- CreateIndex
CREATE INDEX "DetectedItem_userId_date_idx" ON "DetectedItem"("userId", "date");

-- CreateIndex
CREATE INDEX "DetectedItem_userId_merchant_idx" ON "DetectedItem"("userId", "merchant");

-- CreateIndex
CREATE INDEX "EmailTransaction_userId_merchant_idx" ON "EmailTransaction"("userId", "merchant");

-- CreateIndex
CREATE INDEX "EmailTransaction_userId_purchasedAt_idx" ON "EmailTransaction"("userId", "purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTransaction_userId_provider_messageId_key" ON "EmailTransaction"("userId", "provider", "messageId");

-- CreateIndex
CREATE INDEX "ReceiptDocument_userId_emailTransactionId_idx" ON "ReceiptDocument"("userId", "emailTransactionId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_userId_subscriptionId_paidAt_idx" ON "SubscriptionPayment"("userId", "subscriptionId", "paidAt");

-- CreateIndex
CREATE INDEX "Notification_userId_scheduledFor_idx" ON "Notification"("userId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_dismissedAt_idx" ON "Notification"("userId", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");

-- CreateIndex
CREATE INDEX "NotificationJob_status_sendAt_idx" ON "NotificationJob"("status", "sendAt");

-- CreateIndex
CREATE INDEX "NotificationJob_userId_sendAt_idx" ON "NotificationJob"("userId", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationJob_userId_dedupeKey_key" ON "NotificationJob"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ShipmentEvent_returnId_occurredAt_idx" ON "ShipmentEvent"("returnId", "occurredAt");

-- CreateIndex
CREATE INDEX "ShipmentEvent_userId_occurredAt_idx" ON "ShipmentEvent"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundCase_returnId_key" ON "RefundCase"("returnId");

-- CreateIndex
CREATE INDEX "ValueEvent_userId_occurredAt_idx" ON "ValueEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ValueEvent_userId_type_idx" ON "ValueEvent"("userId", "type");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnoozedEvent" ADD CONSTRAINT "SnoozedEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptUpload" ADD CONSTRAINT "ReceiptUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAttachment" ADD CONSTRAINT "PurchaseAttachment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDeletionJob" ADD CONSTRAINT "DataDeletionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationSuggestion" ADD CONSTRAINT "AutomationSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedItem" ADD CONSTRAINT "DetectedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedItem" ADD CONSTRAINT "DetectedItem_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTransaction" ADD CONSTRAINT "EmailTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptDocument" ADD CONSTRAINT "ReceiptDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptDocument" ADD CONSTRAINT "ReceiptDocument_emailTransactionId_fkey" FOREIGN KEY ("emailTransactionId") REFERENCES "EmailTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundCase" ADD CONSTRAINT "RefundCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundCase" ADD CONSTRAINT "RefundCase_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueEvent" ADD CONSTRAINT "ValueEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
