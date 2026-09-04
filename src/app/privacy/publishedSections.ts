import { SECTIONS, type Block, type Section } from "./content";

export const PUBLISHED_EFFECTIVE_DATE = "4 September 2026";
export const PUBLISHED_POLICY_URL = "https://inunity.ca/privacy";

const communitySection: Section = {
  id: "community-gift-card-inventory",
  title: "Optional community gift-card inventory",
  blocks: [
    {
      kind: "note",
      text: "This feature is off by default. You can opt in under iOS Settings → PickMe → Share gift-card inventory, and turn it off again at any time. Local Found it / Not here learning continues even when community sharing is off.",
    },
    {
      kind: "p",
      text: "When community inventory is enabled, PickMe can ask the In Unity server whether other anonymous reports exist for the nearby stores Apple Maps already returned. That query sends the target gift-card name plus each candidate store's Apple place identifier. If a place identifier is unavailable, it sends the merchant name with store coordinates rounded to four decimal places instead.",
    },
    {
      kind: "p",
      text: "When you tap Found it or Not here, a later nearby scan can anonymously submit that observation. The submission contains a random observation UUID, the same store identity described above, the gift-card name, Found it or Not here, and the observation time. If an Apple place identifier exists, PickMe omits the coordinates from the submission.",
    },
    {
      kind: "p",
      text: "Community inventory requests do not include your credit card, purchase amount, transaction or purchase history, PickMe account, email address, Clerk identity, or a device identifier. You do not need a PickMe account to use the feature, and community inventory rows have no user or device relation in the database.",
    },
    {
      kind: "p",
      text: "Community reports older than 90 days are ignored for results and are removed opportunistically when new reports arrive. Results returned to PickMe are grouped by physical store and day and capped at three evidence units per store, gift card, and day. PickMe — not the server — applies the freshness and confidence rules used to rank a route.",
    },
    {
      kind: "p",
      text: "Turning the setting off stops community queries and submissions and clears the community evidence cache on your iPhone. Because submitted community rows deliberately contain no account or device identity, they cannot later be selected by account for individual deletion; after 90 days they stop contributing to results and are eligible for opportunistic cleanup.",
    },
  ],
};

function rewriteBlock(sectionId: string, block: Block): Block {
  if (sectionId === "short-version" && block.kind === "note" && block.text.startsWith("You can use PickMe on your iPhone without ever creating an account.")) {
    return {
      kind: "note",
      text: "You can use PickMe on your iPhone without ever creating an account. Account sync and Wallet Shortcut records require an account. Separately, if you explicitly enable optional community gift-card inventory, anonymous store-and-gift-card observations can reach the server without an account; that feature is described below and is off by default.",
    };
  }

  if (sectionId === "two-stores" && block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => {
        if (row[0] === "Exists") {
          return [row[0], row[1], "Account data only if you create an account; anonymous community gift-card inventory only if you separately opt in"];
        }
        if (row[0] === "Holds") {
          return [row[0], row[1], "Everything attached to your account, including Wallet Shortcut transactions; plus anonymous community gift-card inventory reports when that optional feature is enabled"];
        }
        if (row[0] === "Can I read it") {
          return [row[0], row[1], "Yes for account data. Anonymous community inventory reports are intentionally not linked to an account or device"];
        }
        if (row[0] === "Erased by") {
          return [row[0], row[1], "Delete my data or Delete account for account data. Anonymous community inventory stops contributing after 90 days and is removed opportunistically"];
        }
        return row;
      }),
    };
  }

  if (sectionId === "on-device" && block.kind === "p" && block.text.startsWith("The shopping record described above — merchants, recommendations, purchase entries, and corrections — never leaves your device.")) {
    return {
      kind: "p",
      text: "The shopping record described above — merchants, recommendations, purchase entries, and corrections — never leaves your device. When you sign in, the separate wallet configuration listed under Your cards and Your card settings does sync so the server can evaluate Wallet Shortcut captures. Gift-card inventory feedback is a separate optional evidence stream: it can be shared anonymously only if you enable community gift-card inventory.",
    };
  }

  if (sectionId === "what-leaves" && block.kind === "p" && block.text.startsWith("Searching for nearby merchants sends a request to Apple")) {
    return {
      kind: "p",
      text: "Searching for nearby merchants sends a request to Apple, which answers it. By default, nothing else goes anywhere while you are signed out. If you separately enable optional community gift-card inventory, PickMe can also send the narrow anonymous store-and-gift-card evidence described in the community inventory section below; no account is required for that optional feature.",
    };
  }

  if (sectionId === "what-leaves" && block.kind === "p" && block.text.startsWith("That is the entire outbound payload surface of the app.")) {
    return {
      kind: "p",
      text: "Outside the optional community gift-card inventory feature described below, that is the complete outbound payload surface of the signed-in app. Cap-ledger and feedback sync is otherwise a pull: the app asks the server for figures and receives them. It does not push your prediction log, purchase entries, or saved merchant history as account data.",
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
