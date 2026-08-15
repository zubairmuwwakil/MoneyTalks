import { z } from "zod";
import { formBoolean } from "./primitives";

/** Mirrors the Prisma `TxType` enum (prisma/schema.prisma) and the CSV import form's type selects. */
export const TX_TYPES = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"] as const;

const nonnegativeInt = z.coerce.number().int().nonnegative();

/**
 * The CSV column-mapping + sign-convention fields submitted by the import
 * form. Column indexes are 0-based positions into each parsed CSV row;
 * `positiveType`/`negativeType` decide the resulting `TxType` from the sign
 * of the mapped amount.
 */
export const csvImportInput = z.object({
  dateCol: nonnegativeInt,
  amountCol: nonnegativeInt,
  descriptionCol: nonnegativeInt,
  dateFormat: z.enum(["YMD", "MDY", "DMY"]),
  negate: formBoolean,
  hasHeader: formBoolean,
  positiveType: z.enum(TX_TYPES),
  negativeType: z.enum(TX_TYPES),
});

export type CsvImportInput = z.infer<typeof csvImportInput>;
