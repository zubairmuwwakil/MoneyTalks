import { it, expect } from "vitest";

import { resolveEmailMerchant, resolveEmailMerchantIdentity } from "./emailMerchant";

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

it("pack-beats-heuristic", async () => {
  const db = fakeDb([{ rawString: "ubereats.com", normalizedName: "Wrong alias" }]);

  expect(
    await resolveEmailMerchant(db, "ubereats.com", "Uber Receipts <receipts@ubereats.com>"),
  ).toBe("Uber Eats");
});

it("uses pack match keys before an alias for an unlisted country domain", async () => {
  const db = fakeDb([{ rawString: "netflix.co.uk", normalizedName: "Wrong alias" }]);

  expect(
    await resolveEmailMerchant(db, "netflix.co.uk", "info@netflix.co.uk"),
  ).toBe("Netflix");
});

it("keeps UK merchants distinct after every resolution tier", async () => {
  const db = fakeDb();
  const merchants = await Promise.all([
    resolveEmailMerchant(db, "shopify.co.uk", "notifications@shopify.co.uk"),
    resolveEmailMerchant(db, "britishgas.co.uk", "billing@britishgas.co.uk"),
    resolveEmailMerchant(db, "netflix.co.uk", "info@netflix.co.uk"),
  ]);

  expect(merchants).toEqual(["shopify.co.uk", "britishgas.co.uk", "Netflix"]);
  expect(new Set(merchants).size).toBe(3);
  expect(merchants).not.toContain("co.uk");
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

it("resolves a PayPal receipt from the named payee instead of the payment rail", async () => {
  const db = fakeDb();

  const resolution = await resolveEmailMerchantIdentity(
    db,
    "paypal.com",
    "service@paypal.com",
    {
      subject: "Your receipt for your PayPal payment to Acme Hosting Inc.",
      textBody: "You sent a payment of $9.03 CAD to Acme Hosting Inc.",
    },
  );

  expect(resolution).toEqual({
    merchant: "Acme Hosting Inc",
    identity: "RESOLVED",
    source: "CONDUIT_CONTENT",
  });
  expect(db.created).toContainEqual({
    rawString: "Acme Hosting Inc",
    normalizedName: "Acme Hosting Inc",
  });
  expect(db.created).not.toContainEqual(expect.objectContaining({ rawString: "paypal.com" }));
});

it("marks a conduit receipt unresolved when its payee is not recoverable", async () => {
  const db = fakeDb();

  await expect(resolveEmailMerchantIdentity(
    db,
    "paypal.com",
    "service@paypal.com",
    { subject: "Your PayPal receipt", textBody: "Payment completed." },
  )).resolves.toEqual({
    merchant: "Unresolved payee via PayPal",
    identity: "UNRESOLVED_CONDUIT",
    source: "CONDUIT_UNRESOLVED",
  });
  expect(db.created).toEqual([]);
});

it("does not promote a visibly truncated conduit payee to canonical identity", async () => {
  const db = fakeDb();

  await expect(resolveEmailMerchantIdentity(
    db,
    "paypal.com",
    "service@paypal.com",
    {
      subject: "Receipt for Your Payment to AICA Merchant Servic...",
      textBody: "You paid $27.77 CAD to AICA Merchant Servic...",
    },
  )).resolves.toMatchObject({
    identity: "UNRESOLVED_CONDUIT",
    source: "CONDUIT_UNRESOLVED",
  });
  expect(db.created).toEqual([]);
});

it("uses a Shopify Email sender's merchant display name, not the platform domain", async () => {
  const db = fakeDb();

  await expect(resolveEmailMerchantIdentity(
    db,
    "shopifyemail.com",
    "North Star Coffee <store+123@shopifyemail.com>",
    { subject: "Your order is on the way" },
  )).resolves.toMatchObject({
    merchant: "North Star Coffee",
    identity: "RESOLVED",
    source: "CONDUIT_CONTENT",
  });
});
