/**
 * Compatibility-safe money primitives.
 *
 * Existing database columns use Postgres INTEGER and the application currently
 * exposes number minor units. These guards make every new boundary reject
 * fractions, unsafe integers, and accidental bigint serialization. The bigint
 * helpers provide the migration seam for a later storage upgrade without
 * forcing a risky all-at-once rewrite of every existing query and API DTO.
 */
export type MinorUnit = number & { readonly __brand: "MinorUnit" };

export function minorUnit(value: number): MinorUnit {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money minor units must be a safe integer; received ${value}`);
  }
  return value as MinorUnit;
}

export function minorUnitFromBigInt(value: bigint): MinorUnit {
  const numberValue = Number(value);
  if (BigInt(numberValue) !== value) {
    throw new RangeError("Money value exceeds the safe integer range");
  }
  return minorUnit(numberValue);
}

export function minorUnitToBigInt(value: MinorUnit): bigint {
  return BigInt(value);
}

export function assertCurrencyCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new RangeError(`Currency code must be an ISO 4217 alpha-3 code; received ${value}`);
  }
  return normalized;
}
