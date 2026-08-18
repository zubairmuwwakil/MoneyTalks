import { it, expect } from "vitest";

import { resolveEmailMerchant } from "./emailMerchant";

function fakeDb(seed: { rawString: string; normalizedName: string }[] = []) {
  const rows = [...seed];
  return {
    created: rows,
    merchantAlias: {
      findUnique: async ({ where }: { where: { rawString: string } }) =>
        rows.find((r) => r.rawString === where.rawString) ?? null,
      create: async ({ data }: { data: { rawString: string; normalizedName: string } }) => {
        if (rows.some((r) => r.rawString === data.rawString)) throw new Error("unique violation");
        rows.push(data);
        return data;
      },
    },
  };
}

it("returns the curated name for a known sender", async () => {
  // What /settings/merchants curation is for: the raw domain the email
  // parser produces maps to the brand the user actually recognises.
  const db = fakeDb([{ rawString: "americanexpress.com", normalizedName: "American Express" }]);

  expect(await resolveEmailMerchant(db, "americanexpress.com")).toBe("American Express");
});

it("seeds an alias on first sighting so it becomes curatable", async () => {
  const db = fakeDb();

  expect(await resolveEmailMerchant(db, "simons.ca")).toBe("simons.ca");
  expect(db.created).toContainEqual({ rawString: "simons.ca", normalizedName: "simons.ca" });
});

it("survives a concurrent scan creating the same alias", async () => {
  const db = fakeDb();
  let firstLookup = true;
  db.merchantAlias.findUnique = async ({ where }) => {
    if (firstLookup) {
      firstLookup = false;
      return null; // we lose the race...
    }
    return { rawString: where.rawString, normalizedName: "Nike" }; // ...and read theirs
  };
  db.merchantAlias.create = async () => {
    throw new Error("unique violation");
  };

  expect(await resolveEmailMerchant(db, "nike.com")).toBe("Nike");
});

it("falls back to the raw string when the alias table is unusable", async () => {
  const db = fakeDb();
  db.merchantAlias.findUnique = async () => {
    throw new Error("db down");
  };

  // A merchant name must never block ingestion.
  expect(await resolveEmailMerchant(db, "vercel.com")).toBe("vercel.com");
});
