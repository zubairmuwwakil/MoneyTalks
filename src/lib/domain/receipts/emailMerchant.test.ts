import { describe, it, expect } from "vitest";

import {
  conduitForSender,
  resolveEmailMerchant,
  resolveEmailMerchantIdentity,
} from "./emailMerchant";

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

describe("Stripe conduit", () => {
  it("resolves a Stripe receipt from the subject payee", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "stripe.com",
      "receipts+acct_1a2b3c4d5e@stripe.com",
      {
        subject: "Your receipt from Fictional Cloud Hosting (#1024-5678)",
        textBody: "You paid $29.00 USD to Fictional Cloud Hosting.",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Cloud Hosting",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
    expect(db.created).toContainEqual({
      rawString: "Fictional Cloud Hosting",
      normalizedName: "Fictional Cloud Hosting",
    });
  });

  it("resolves a Stripe receipt from the sender display name when subject is generic", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "stripe.com",
      '"Fictional Metrics via Stripe" <receipts+acct_9z8y7x@stripe.com>',
      {
        subject: "Your receipt",
        textBody: "Thank you for your business.",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Metrics",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
  });

  it("marks a Stripe receipt unresolved when payee cannot be recovered", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "stripe.com",
      "receipts+acct_unknown123@stripe.com",
      {
        subject: "Your receipt",
        textBody: "Payment of $15.00 was successful.",
      },
    );

    expect(resolution).toEqual({
      merchant: "Unresolved payee via Stripe",
      identity: "UNRESOLVED_CONDUIT",
      source: "CONDUIT_UNRESOLVED",
    });
  });

  it("does not treat a non-conduit Stripe email as a conduit", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "stripe.com",
      "support@stripe.com",
      {
        subject: "Updates to your Stripe developer account",
        textBody: "Here are the updates.",
      },
    );

    expect(resolution).toEqual({
      merchant: "stripe.com",
      identity: "RESOLVED",
      source: "SENDER",
    });
  });
});

describe("Apple conduit", () => {
  it("resolves an Apple receipt from subscription renewal wording in the body", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "apple.com",
      "no_reply@email.apple.com",
      {
        subject: "Your receipt from Apple",
        textBody: "App Store\nYour subscription to Fictional Stream Pro will renew on September 15, 2026 for $12.99.",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Stream Pro",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
    expect(db.created).toContainEqual({
      rawString: "Fictional Stream Pro",
      normalizedName: "Fictional Stream Pro",
    });
  });

  it("resolves an Apple receipt from seller or developer line in the body", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "apple.com",
      "Apple <no_reply@email.apple.com>",
      {
        subject: "Your invoice from Apple",
        textBody: "Item: Fictional Photo Editor\nSeller: Fictional Labs Inc.\nReport a Problem\nTotal: $4.99",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Labs Inc",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
  });

  it("resolves the first item when multiple subscriptions are listed in one email", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "apple.com",
      "no_reply@email.apple.com",
      {
        subject: "Your invoice from Apple",
        textBody: "App Store\nFictional Meditation App\nRenews Oct 12, 2026\n$9.99\n\nFictional Podcast Pro\nRenews Oct 15, 2026\n$4.99",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Meditation App",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
  });

  it("marks an Apple receipt unresolved when no specific payee or item is recoverable", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "apple.com",
      "no_reply@email.apple.com",
      {
        subject: "Your receipt from Apple",
        textBody: "App Store\nPayment completed. Total: $10.00",
      },
    );

    expect(resolution).toEqual({
      merchant: "Unresolved payee via Apple",
      identity: "UNRESOLVED_CONDUIT",
      source: "CONDUIT_UNRESOLVED",
    });
  });

  it("does not treat a non-conduit Apple sender as a conduit", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "apple.com",
      "news@apple.com",
      {
        subject: "Apple Special Event",
        textBody: "Join us for the event.",
      },
    );

    expect(resolution).toEqual({
      merchant: "Apple Services (App Store, Music, iCloud)",
      identity: "RESOLVED",
      source: "SENDER",
    });
  });
});

describe("Google Play conduit", () => {
  it("resolves a Google Play receipt from googleplay-noreply@google.com with item and developer", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "google.com",
      "Google Play <googleplay-noreply@google.com>",
      {
        subject: "Your Google Play order receipt from Aug 30, 2026",
        textBody: "Order number: GPA.1234-5678-9012-34567\nItem: Fictional Fitness Tracker (Monthly)\nSold by: Fictional Fitness Inc.\nPrice: $9.99/month",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Fitness Inc",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
    expect(db.created).toContainEqual({
      rawString: "Fictional Fitness Inc",
      normalizedName: "Fictional Fitness Inc",
    });
  });

  it("resolves a Google Payments receipt from payments-noreply@google.com", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "google.com",
      "Google Payments <payments-noreply@google.com>",
      {
        subject: "Your receipt from Google Payments",
        textBody: "You subscribed to Fictional Cloud Backup on Aug 30, 2026.\nTotal: $4.99",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Cloud Backup",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
  });

  it("marks a Google Play receipt unresolved when no specific payee or item is recoverable", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "google.com",
      "googleplay-noreply@google.com",
      {
        subject: "Your Google Play receipt",
        textBody: "Payment completed. Total: $15.00",
      },
    );

    expect(resolution).toEqual({
      merchant: "Unresolved payee via Google Play",
      identity: "UNRESOLVED_CONDUIT",
      source: "CONDUIT_UNRESOLVED",
    });
  });

  it("does not treat a non-conduit Google sender as a conduit", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "google.com",
      "support@google.com",
      {
        subject: "Google Workspace notification",
        textBody: "Your settings have been updated.",
      },
    );

    expect(resolution).toEqual({
      merchant: "google.com",
      identity: "RESOLVED",
      source: "SENDER",
    });
  });
});

describe("Microsoft billing conduit", () => {
  it("resolves a Microsoft billing receipt with publisher in body", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "microsoft.com",
      "Microsoft <msbill@microsoft.com>",
      {
        subject: "Your Microsoft subscription receipt",
        textBody: "Product: Fictional Dev Tool Pro\nPublisher: Fictional Dev Studios LLC\nTotal: $19.99",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Dev Studios LLC",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
    expect(db.created).toContainEqual({
      rawString: "Fictional Dev Studios LLC",
      normalizedName: "Fictional Dev Studios LLC",
    });
  });

  it("resolves a Microsoft billing receipt for Microsoft 365", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "microsoft.com",
      "msbill@microsoft.com",
      {
        subject: "Your Microsoft invoice",
        textBody: "Description: Microsoft 365 Family\nTotal: $99.00/year",
      },
    );

    expect(resolution).toEqual({
      merchant: "Xbox Live / Microsoft",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
  });

  it("resolves a Microsoft billing receipt from renewal phrasing", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "microsoft.com",
      "msbill@microsoft.com",
      {
        subject: "Your subscription confirmation",
        textBody: "Your subscription to Fictional Cloud Database has renewed on Aug 30, 2026.\nAmount: $45.00",
      },
    );

    expect(resolution).toEqual({
      merchant: "Fictional Cloud Database",
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    });
  });

  it("marks a Microsoft billing receipt unresolved when no specific product or payee is recoverable", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "microsoft.com",
      "msbill@microsoft.com",
      {
        subject: "Your Microsoft invoice",
        textBody: "Payment completed. Total: $50.00",
      },
    );

    expect(resolution).toEqual({
      merchant: "Unresolved payee via Microsoft",
      identity: "UNRESOLVED_CONDUIT",
      source: "CONDUIT_UNRESOLVED",
    });
  });

  it("does not treat a non-conduit Microsoft sender as a conduit", async () => {
    const db = fakeDb();

    const resolution = await resolveEmailMerchantIdentity(
      db,
      "microsoft.com",
      "support@microsoft.com",
      {
        subject: "Microsoft security alert",
        textBody: "A new sign-in was detected.",
      },
    );

    expect(resolution).toEqual({
      merchant: "Xbox Live / Microsoft",
      identity: "RESOLVED",
      source: "SENDER",
    });
  });
});

describe("conduitForSender", () => {
  it("identifies all registered billing conduits for valid sender addresses", () => {
    expect(conduitForSender("service@paypal.com")).toEqual({ domain: "paypal.com", name: "PayPal" });
    expect(conduitForSender("store+123@shopifyemail.com")).toEqual({
      domain: "shopifyemail.com",
      name: "Shopify Email",
    });
    expect(conduitForSender("receipts+acct_123456@stripe.com")).toEqual({
      domain: "stripe.com",
      name: "Stripe",
    });
    expect(conduitForSender("no_reply@email.apple.com")).toEqual({
      domain: "apple.com",
      name: "Apple",
    });
    expect(conduitForSender("googleplay-noreply@google.com")).toEqual({
      domain: "google.com",
      name: "Google Play",
    });
    expect(conduitForSender("payments-noreply@google.com")).toEqual({
      domain: "google.com",
      name: "Google Play",
    });
    expect(conduitForSender("msbill@microsoft.com")).toEqual({
      domain: "microsoft.com",
      name: "Microsoft",
    });
  });

  it("supports operator CLI queries for conduit domains", () => {
    expect(conduitForSender("operator@stripe.com")).toEqual({ domain: "stripe.com", name: "Stripe" });
    expect(conduitForSender("operator@apple.com")).toEqual({ domain: "apple.com", name: "Apple" });
    expect(conduitForSender("operator@google.com")).toEqual({ domain: "google.com", name: "Google Play" });
    expect(conduitForSender("operator@microsoft.com")).toEqual({ domain: "microsoft.com", name: "Microsoft" });
    expect(conduitForSender("operator@paypal.com")).toEqual({ domain: "paypal.com", name: "PayPal" });
    expect(conduitForSender("operator@shopifyemail.com")).toEqual({
      domain: "shopifyemail.com",
      name: "Shopify Email",
    });
  });

  it("returns undefined for non-conduit sender addresses under conduit domains", () => {
    expect(conduitForSender("support@stripe.com")).toBeUndefined();
    expect(conduitForSender("news@apple.com")).toBeUndefined();
    expect(conduitForSender("support@google.com")).toBeUndefined();
    expect(conduitForSender("support@microsoft.com")).toBeUndefined();
    expect(conduitForSender("someone@gmail.com")).toBeUndefined();
    expect(conduitForSender(null)).toBeUndefined();
    expect(conduitForSender("")).toBeUndefined();
  });
});





