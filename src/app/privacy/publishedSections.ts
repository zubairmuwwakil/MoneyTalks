import { SECTIONS, type Block, type Section } from "./content";

export const PUBLISHED_EFFECTIVE_DATE = "4 September 2026";
export const PUBLISHED_POLICY_URL = "https://inunity.ca/privacy";

const communitySection: Section = {
  id: "community-evidence",
  title: "Optional community gift-card inventory and MCC evidence",
  blocks: [
    {
      kind: "note",
      text: "Community features are off by default. You can opt in separately under iOS Settings → PickMe to share gift-card inventory or confirmed merchant category codes (MCCs), and turn either feature off again. PickMe's local learning continues when community sharing is off.",
    },
    {
      kind: "p",
      text: "For community gift-card inventory, PickMe can ask whether anonymous reports exist for the nearby stores Apple Maps already returned. That query sends the target gift-card name plus each candidate store's Apple place identifier. If a place identifier is unavailable, it sends the merchant name with store coordinates rounded to four decimal places instead.",
    },
    {
      kind: "p",
      text: "When you tap Found it or Not here, a later nearby scan can anonymously submit that observation. The submission contains a random observation UUID, the same store identity described above, the gift-card name, Found it or Not here, and the observation time. If an Apple place identifier exists, PickMe omits the coordinates from the submission. These community inventory submissions do not include your credit card, card number, purchase amount, account, email, user identifier, or device identifier.",
    },
    {
      kind: "p",
      text: "For community MCC learning, PickMe only queues an upload after you explicitly reconcile a purchase with a literal four-digit MCC. The upload contains a random observation UUID, PickMe's canonical merchant identifier, store coordinates rounded to three decimal places (a coarse roughly 100-metre location bucket), the confirmed MCC, and the observation time. It does not contain the card used, purchase amount, Wallet merchant descriptor, reward amount, account, email, Clerk identity, user identifier, or device identifier.",
    },
    {
      kind: "p",
      text: "Community MCC queries use the canonical merchant identifier plus the same three-decimal coarse store-location bucket, matching the upload scope while tolerating normal Wallet-versus-MapKit GPS drift. The server returns only bounded aggregate MCC signals. The anonymous community tables have no user or device relation: raw MCC reports contain no user, account, device, or contributor identifier and have no relation to a User row in the database.",
    },
    {
      kind: "p",
      text: "Community MCC reports older than 180 days are ignored for results and removed opportunistically. A store/network/MCC can contribute at most two aggregate evidence units per UTC day, and PickMe receives no MCC signal until that MCC has support on at least three distinct days. Raw storage is also bounded per physical store and day to resist request flooding. This is a privacy-preserving anti-burst threshold, not proof that three different people submitted the reports. PickMe always treats community MCC results as weaker external evidence; they can never become trusted terminal truth without the owner's own repeated direct MCC observations.",
    },
    {
      kind: "p",
      text: "Community gift-card reports older than 90 days are ignored for results and are removed opportunistically. Gift-card results are grouped by physical store and day and capped at three evidence units per store, gift card, and day. PickMe — not the server — applies the freshness and confidence rules used to rank a route.",
    },
    {
      kind: "p",
      text: "Turning a community setting off stops its future queries and submissions and clears its community evidence cache when PickMe next evaluates that setting. Because submitted community rows deliberately contain no account or device identity, they cannot later be selected by account for individual deletion; they stop contributing after their retention window and are eligible for opportunistic cleanup.",
    },
  ],
};

function rewriteBlock(sectionId: string, block: Block): Block {
  if (sectionId === "short-version" && block.kind === "note" && block.text.startsWith("You can use PickMe on your iPhone without ever creating an account.")) {
    return {
      kind: "note",
      text: "You can use PickMe on your iPhone without ever creating an account. Account sync and Wallet Shortcut records require an account. Separately, if you explicitly enable an optional community feature, narrow anonymous store evidence can reach the server without an account; those features are described below and are off by default.",
    };
  }

  if (sectionId === "two-stores" && block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => {
        if (row[0] === "Exists") {
          return [row[0], row[1], "Account data only if you create an account; anonymous community evidence only if you separately opt in"];
        }
        if (row[0] === "Holds") {
          return [row[0], row[1], "Everything attached to your account, including Wallet Shortcut transactions; plus anonymous community gift-card or MCC reports when those optional features are enabled"];
        }
        if (row[0] === "Can I read it") {
          return [row[0], row[1], "Yes for account data. Anonymous community reports are intentionally not linked to an account or device"];
        }
        if (row[0] === "Erased by") {
          return [row[0], row[1], "Delete my data or Delete account for account data. Anonymous community reports age out under their separate 90-day or 180-day retention rules"];
        }
        return row;
      }),
    };
  }

  if (sectionId === "on-device" && block.kind === "p" && block.text.startsWith("The shopping record described above — merchants, recommendations, purchase entries, and corrections — never leaves your device.")) {
    return {
      kind: "p",
      text: "The shopping record described above — merchants, recommendations, purchase entries, corrections, and local MCC-learning evidence — never leaves your device as account data. If you choose Import issuer MCC CSV, PickMe reads that file locally and keeps only normalized merchant, literal MCC, optional network, and observation-date evidence needed for learning; it does not retain the raw issuer file, imported purchase amount, card/account number, filename, or statement text. When you sign in, the separate wallet configuration listed under Your cards and Your card settings does sync so the server can evaluate Wallet Shortcut captures. Optional community evidence is narrower and separate: only the specific gift-card or literal-MCC fields described below can be shared anonymously when you enable those settings.",
    };
  }

  if (sectionId === "what-leaves" && block.kind === "p" && block.text.startsWith("Searching for nearby merchants sends a request to Apple")) {
    return {
      kind: "p",
      text: "Searching for nearby merchants sends a request to Apple, which answers it. By default, nothing else goes anywhere while you are signed out. If you separately enable an optional community feature, PickMe can also send the narrow anonymous store evidence described in the community section below; no account is required for those optional features.",
    };
  }

  if (sectionId === "what-leaves" && block.kind === "p" && block.text.startsWith("That is the entire outbound payload surface of the app.")) {
    return {
      kind: "p",
      text: "Outside the optional community evidence described below, that is the complete outbound payload surface of the signed-in app. Cap-ledger and feedback sync is otherwise a pull: the app asks the server for figures and receives them. It does not push your prediction log, purchase entries, saved merchant history, or locally imported MCC-learning evidence as account data.",
    };
  }

  return block;
}

const rewritten = SECTIONS.map<Section>((section) => ({
  ...section,
  blocks: section.blocks.map((block) => rewriteBlock(section.id, block)),
}));

const insertAfter = rewritten.findIndex((section) => section.id === "what-leaves");
export const PUBLISHED_SECTIONS: Section[] = insertAfter < 0
  ? [...rewritten, communitySection]
  : [...rewritten.slice(0, insertAfter + 1), communitySection, ...rewritten.slice(insertAfter + 1)];
