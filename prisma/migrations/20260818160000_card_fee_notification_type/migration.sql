-- The annual-fee decision reminder. Two notifications share this type per
-- cycle (fee posting, then the cancel deadline); they are told apart by
-- eventKey, not by type.
ALTER TYPE "NotificationType" ADD VALUE 'CARD_FEE_DECISION_SOON';
