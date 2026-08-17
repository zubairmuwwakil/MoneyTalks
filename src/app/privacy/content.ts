// The published privacy policy, as content rather than markup.
//
// Why data and not JSX: this text is the legally operative artifact, and it is
// checked by `policy-claims.test.ts`, which greps it for statements that
// shipped code contradicts (see PickMe/docs/compliance/account-deletion.md §5).
// Plain strings keep the prose greppable and free of HTML entities that would
// silently break those assertions. The long-form working document stays in
// PickMe/docs/compliance/privacy-policy.md; this is what is published.
//
// Voice: plain, specific, and willing to say what the software does not do.
// Do not make it sound like marketing.

export const EFFECTIVE_DATE = "17 August 2026";
export const CONTACT_EMAIL = "zmuwwakil1@gmail.com";
export const PUBLISHER = "Zubair Muwwakil";
export const POLICY_URL = "https://moneytalks.zubairmuwwakil.com/privacy";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "sub"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export type Section = {
  id: string;
  title: string;
  blocks: Block[];
};

// Inline links are written as [label](href) and parsed by the renderer.
export const SECTIONS: Section[] = [
  {
    id: "short-version",
    title: "The short version",
    blocks: [
      {
        kind: "p",
        text: "PickMe tells you which credit card in your wallet earns the most on the purchase you are about to make. There are two separate places your information can live, they work very differently, and the difference is the most important thing on this page.",
      },
      {
        kind: "p",
        text: "**On your iPhone.** The app keeps a detailed record of the merchants you confirm, the advice it gave you, and your corrections to it. That record is never uploaded. There is no code in the app that sends it anywhere.",
      },
      {
        kind: "p",
        text: "**On the server, but only if you create an account.** A PickMe account is optional. If you make one, the web hub at moneytalks.zubairmuwwakil.com holds the data you put into it, and — if you set up the optional Wallet Shortcut — a record of your card transactions, including the amount, the merchant, and the card used.",
      },
      {
        kind: "note",
        text: "You can use PickMe on your iPhone without ever creating an account. If you never sign in, nothing about your shopping reaches the server, because there is nothing to send it to and no account to attach it to.",
      },
      {
        kind: "p",
        text: "Neither the app nor the server ever connects to your bank or your card issuer. Nothing here asks for card numbers, PINs, or online banking credentials, and no screen anywhere accepts them.",
      },
    ],
  },
  {
    id: "who-is-responsible",
    title: "Who is responsible",
    blocks: [
      {
        kind: "p",
        text: `PickMe and the MoneyTalks web hub are built and published by ${PUBLISHER}, an individual developer, not a company. There is no incorporated entity behind this, no team, and no data protection department.`,
      },
      {
        kind: "p",
        text: `That means the person responsible for the protection of your personal information is ${PUBLISHER}, reachable at ${CONTACT_EMAIL}. Requests and complaints go to the same address, because there is nobody else to route them to.`,
      },
      {
        kind: "note",
        text: "Being a one-person project is a fact about the service, not a reduction of your rights. The obligations described in this policy apply in full.",
      },
    ],
  },
  {
    id: "two-stores",
    title: "Two stores, two owners",
    blocks: [
      {
        kind: "p",
        text: "The most common way to misread a privacy policy like this one is to conclude that PickMe holds nothing at all. That is true of the server for people who never sign in. It is not true of your iPhone, and it is not true of the server once you have an account.",
      },
      {
        kind: "table",
        head: ["", "On your iPhone", "On the server"],
        rows: [
          ["Exists", "Always, from first launch", "Only if you create an account"],
          [
            "Holds",
            "Merchants you confirmed with their coordinates, every recommendation made, your corrections",
            "Everything attached to your account, including Wallet Shortcut transactions",
          ],
          ["Can I read it", "No. It is never uploaded", "Yes. It is on a server I administer"],
          [
            "Erased by",
            "Erase This iPhone's History, or deleting the app",
            "Delete my data, or Delete account",
          ],
        ],
      },
      {
        kind: "p",
        text: "Apple's App Privacy labels describe the on-device store as data not collected, because Apple treats information that is processed only on the device and never sent off it as uncollected. That is a correct answer to Apple's question. It is not a claim that the app holds nothing — it plainly does, and this policy describes it in detail below.",
      },
    ],
  },
  {
    id: "on-device",
    title: "What PickMe stores on your iPhone",
    blocks: [
      {
        kind: "p",
        text: "All of this is written to a database inside the app's own storage area on your device, and it stays there.",
      },
      { kind: "sub", text: "Your cards" },
      {
        kind: "p",
        text: "Which card products you picked from the catalogue built into the app — for example an American Express Cobalt Card. The catalogue ships with the app; choosing a card from it tells nobody anything.",
      },
      {
        kind: "note",
        text: "The app never asks for and never stores card numbers, expiry dates, security codes, PINs, cardholder names, or online banking credentials. There is no field anywhere in the app that accepts them. If any screen ever appears to ask you for a card number, it is not this app.",
      },
      { kind: "sub", text: "Your card settings" },
      {
        kind: "bullets",
        items: [
          "which card is your everyday default",
          "which cards you keep at home rather than in your wallet",
          "bonus categories you selected with your issuer, where a card offers that choice",
          "whether a paid plan or subscription tier is active on a card",
          "the month the account was opened, where a card's bonus limits reset on that anniversary",
          "your own estimates of how much you have spent toward each card's monthly or annual bonus cap — approximate spending figures that you enter yourself",
          "what you believe your points are worth, in cents per point, including any figure you edit",
        ],
      },
      { kind: "sub", text: "Merchants you confirm" },
      {
        kind: "bullets",
        items: [
          "the merchant name",
          "the Apple Maps place identifier, where one exists",
          "the merchant's latitude and longitude",
          "the purchase category you confirmed for it",
          "how many times you have confirmed it, and when it was last used",
        ],
      },
      { kind: "sub", text: "Every recommendation the app has made" },
      {
        kind: "bullets",
        items: [
          "the date and time",
          "the merchant name and identifier",
          "the category the app predicted, how confident it was, and why",
          "the card it recommended and the dollar value it calculated, and the runner-up",
          "the point valuation in force at that moment",
          "the explanation text you were shown",
          "the purchase amount, only if you chose to enter one — entering an amount is always optional and always skippable",
        ],
      },
      { kind: "sub", text: "Your corrections" },
      {
        kind: "bullets",
        items: [
          "which card you actually paid with",
          "the category the purchase actually coded as",
          "a classification of what went wrong, if anything",
          "any free-text note you write",
          "the date you confirmed it",
        ],
      },
      { kind: "sub", text: "What this adds up to, stated plainly" },
      {
        kind: "p",
        text: "Taken together, this is a running record of where you shopped, when, roughly how much you spent, and which card you used — including precise coordinates sitting at rest on your phone. Your card settings also include approximate figures for your annual spending in certain categories. That is genuinely personal information, and it is treated as such.",
      },
      {
        kind: "p",
        text: "That is exactly why the app is built so this record never leaves your device. The design decision came first; this policy describes it rather than promising it.",
      },
    ],
  },
  {
    id: "what-leaves",
    title: "What actually leaves your iPhone",
    blocks: [
      {
        kind: "p",
        text: "This section replaces a claim in earlier drafts of this policy, written before accounts existed, that Apple Maps was the only network activity the app performed. That stopped being true when account sync shipped, and the correction matters more than the tidier sentence did.",
      },
      { kind: "sub", text: "When you are signed out" },
      {
        kind: "p",
        text: "Searching for nearby merchants sends a request to Apple, which answers it. Nothing else goes anywhere. See the Apple Maps section below.",
      },
      { kind: "sub", text: "When you are signed in" },
      {
        kind: "p",
        text: "The app talks to the MoneyTalks server, and this is the complete list of what it sends:",
      },
      {
        kind: "bullets",
        items: [
          "your Clerk sign-in token, which identifies your account on every request",
          '{"label": "..."} — a name you type, such as “my iPhone”, when you create a Wallet Shortcut installation token',
          '{"scope": "account"} — when you ask to delete your account',
        ],
      },
      {
        kind: "p",
        text: "That is the entire outbound payload surface of the app. Cap usage and feedback sync is a pull: the app asks the server for figures and receives them. It does not push your prediction log, your confirmations, or your saved merchant locations, because no code in the app reads those models for transmission.",
      },
      {
        kind: "note",
        text: "The Wallet Shortcut is a separate thing from the app, and it does send transaction data. It is covered in its own section below, because it is the one part of this system most likely to surprise you.",
      },
    ],
  },
  {
    id: "location",
    title: "Location on your iPhone",
    blocks: [
      {
        kind: "p",
        text: "With your permission, the app takes a single location reading to ask Apple Maps which shops are near you, so you can pick the one you are standing in from a short list instead of typing its name.",
      },
      {
        kind: "bullets",
        items: [
          "Location is off until you turn it on. The app does not ask on first launch and does not work around a refusal.",
          "The app requests While Using the App permission. It never requests Always.",
          "Each reading is a one-time fix, taken when you tap to find nearby merchants. The code requests single fixes and never starts continuous background updates.",
          "Your coordinates are not saved as a trail. What is saved is the location of a merchant you confirmed, so it can be offered to you again next time you are there.",
        ],
      },
      {
        kind: "p",
        text: "If you turn on ambient alerts, the app also asks iOS to watch geofences around up to twenty merchants you have already confirmed, so it can offer advice as you arrive. Those geofences are set on your device, evaluated by iOS, and removed when you erase your local history.",
      },
      {
        kind: "p",
        text: "If you say no to location, the app remains fully usable. Every feature is reachable by searching for a merchant by name. Declining costs you the shortcut, not the product. You can revoke permission at any time in iOS Settings, under Privacy & Security, then Location Services.",
      },
    ],
  },
  {
    id: "apple-maps",
    title: "Apple Maps",
    blocks: [
      {
        kind: "p",
        text: "When you look for nearby merchants or search for one by name, iOS sends that request to Apple to answer it. I do not receive that request, I am not told what you searched for, and I get no copy of the result.",
      },
      {
        kind: "p",
        text: "Apple's handling of those requests is governed by [Apple's Privacy Policy](https://www.apple.com/legal/privacy/), not by this one. Because no copy reaches me, there is nothing on my side to delete.",
      },
    ],
  },
  {
    id: "server",
    title: "If you have a PickMe account: what the server holds",
    blocks: [
      {
        kind: "p",
        text: "Creating an account is optional and the app works without one. If you create one, the following is stored on the server against your user record.",
      },
      {
        kind: "bullets",
        items: [
          "Sign-in details, handled by Clerk, my authentication provider: your email address and the credentials or third-party sign-in you chose. Passwords are held by Clerk, not by me, and I never see them.",
          "Whatever you enter in the web hub: purchases, returns, subscriptions, bills, receipts and their uploaded files, investments, and notification preferences.",
          "Transactions captured by the Wallet Shortcut, if you set it up — see the next section.",
          "Cap usage ledgers and accruals, which track progress toward your cards' bonus limits.",
          "Your card and merchant settings as held server-side, and the alias tables that map raw transaction text to a known card or merchant.",
          "Wallet Shortcut installations: the label you gave each one and a hashed copy of its token. The token itself is not stored in a form I can read back.",
          "If you connect an email account, the connection details described in the email section below.",
        ],
      },
      {
        kind: "p",
        text: "There is no analytics SDK, no advertising, no ad identifiers, no cross-app or cross-site tracking, and no data broker anywhere in this system. Your information is not sold, rented, or shared for anyone else's purposes. It is used to operate the features you are using.",
      },
      {
        kind: "p",
        text: "The server does not connect to your bank or card issuer, and it holds no payment instrument of yours. It cannot move money.",
      },
    ],
  },
  {
    id: "wallet-shortcut",
    title: "The Wallet Shortcut",
    blocks: [
      {
        kind: "p",
        text: "The Wallet Shortcut is an Apple Shortcut you build and install yourself, on your own device. It is optional, it is off unless you set it up, and it is the route by which your actual card transactions reach the server. It is worth reading this section carefully even if you skipped the rest.",
      },
      {
        kind: "p",
        text: "When it runs — typically as an automation after an Apple Pay tap — it posts to the wallet-events endpoint on the server, authenticated by an installation token you created. It sends:",
      },
      {
        kind: "bullets",
        items: [
          "the merchant name and transaction description as Apple Wallet renders them",
          "the amount and currency",
          "the card description as Apple Wallet renders it",
          "the time of the transaction, with your device's time zone",
          "your latitude and longitude at that moment, if you included the Get Current Location action when you built the Shortcut",
        ],
      },
      {
        kind: "p",
        text: "The payload is also kept verbatim as received, so that improved parsing can re-read your history later rather than silently misreading it once. That means a raw copy of the above is retained alongside the interpreted version.",
      },
      { kind: "sub", text: "About the coordinates" },
      {
        kind: "p",
        text: "If your Shortcut sends location, those coordinates are stored precisely and kept as part of your transaction history. They are not blurred or discarded after the merchant is identified. The reason is that the complete record is the product — location is what lets the server tell a coffee shop from a gas station when the transaction text is unreadable. But it means the server holds a map of where you paid for things, and you should decide about that deliberately rather than by default.",
      },
      {
        kind: "note",
        text: "You control this when you build the Shortcut. Delete the Get Current Location action and everything else still works; captures simply arrive without coordinates. You can also revoke a Shortcut installation at any time from the web hub, which stops that device from posting anything further.",
      },
      {
        kind: "p",
        text: "The Shortcut is a transport, not an observer. It reads what you hand it at the moment it runs. It does not have access to your Apple Wallet history, your bank, or your card account, and it cannot run on its own without the automation you configured.",
      },
    ],
  },
  {
    id: "email",
    title: "Connecting an email account",
    blocks: [
      {
        kind: "p",
        text: "The web hub can read receipts and order confirmations out of your mailbox so purchases, returns, and subscriptions fill themselves in. This is optional and off until you connect an account. It is also the most invasive permission in the whole system, so here is the unflattering version.",
      },
      { kind: "sub", text: "Gmail" },
      {
        kind: "p",
        text: "Connecting Gmail requests the gmail.readonly scope, along with basic profile and email address. That scope grants read access to your entire mailbox — every message, including bodies and attachments, not only receipts. It does not grant permission to send, modify, or delete anything.",
      },
      {
        kind: "note",
        text: "The scan mode setting in the web hub — all messages, receipts only, shipping only, or subscriptions only — narrows what the server actually processes. It does not narrow what Google authorized. That is a genuine gap between the permission and the practice, and you should judge the permission, because it is the part that is enforced.",
      },
      { kind: "sub", text: "IMAP" },
      {
        kind: "p",
        text: "As an alternative you can supply IMAP server details and a password, ideally an app-specific password rather than your main one. It is encrypted before it is stored and is never returned to the browser afterwards; the interface can only tell you whether a password is set, not what it is.",
      },
      { kind: "sub", text: "What is kept" },
      {
        kind: "p",
        text: "From scanned mail the server keeps what it extracted — merchants, amounts, dates, order and tracking numbers, line items, and the linked purchase, return, or subscription records. Access tokens and IMAP credentials are encrypted at rest.",
      },
      {
        kind: "p",
        text: "You can disconnect an email account at any time from Settings, then Privacy & Data, in the web hub. Disconnecting removes the stored credentials. Records already extracted remain until you delete your data, so that your purchase history does not develop holes; deleting your data or your account removes them.",
      },
    ],
  },
  {
    id: "retention",
    title: "How long information is kept",
    blocks: [
      { kind: "sub", text: "On your iPhone" },
      {
        kind: "p",
        text: "Until you erase it. There is no expiry, and I cannot reach it to remove it on your behalf — it was never uploaded, so there is nothing on my side to act on. Deleting the app removes its database with it, in the ordinary iOS way.",
      },
      {
        kind: "note",
        text: "If you back up your iPhone to iCloud or to a computer, that backup may include the app's data, as it does for other apps. Those backups are controlled by your own iOS and iCloud settings and by Apple. If you want the data gone from a backup, manage or delete the backup itself.",
      },
      { kind: "sub", text: "On the server" },
      {
        kind: "p",
        text: "Until you delete it. Account data is kept for as long as the account exists, because it is the history the product is for. There is no automatic expiry, and old transactions are not aged out.",
      },
      {
        kind: "p",
        text: "When you delete your data or your account, deletion is immediate rather than scheduled, and it is not a soft delete — the rows are removed. No shadow copy is retained, and no record of the deletion survives it. If a deletion fails partway, a record of the failure remains so you can retry, because in that case your account still exists.",
      },
    ],
  },
  {
    id: "deletion",
    title: "Deleting your information: three controls",
    blocks: [
      {
        kind: "p",
        text: "Because there are two stores, there are separate controls, and one of them deliberately does not require an account.",
      },
      {
        kind: "table",
        head: ["Control", "Where", "Account needed", "What it removes"],
        rows: [
          [
            "Erase This iPhone's History",
            "PickMe, gear icon, This iPhone",
            "No",
            "The entire on-device store: recommendations, corrections, saved merchants and their coordinates, mute list, counters, and any live geofences",
          ],
          [
            "Delete my data",
            "Web hub, Settings, Privacy & Data",
            "Yes",
            "Every server record belonging to you. Your account and sign-in survive, so you can start over with an empty slate",
          ],
          [
            "Delete account",
            "PickMe, gear icon, Danger zone — and the web hub, Settings, Privacy & Data",
            "Yes",
            "Your entire server record and the account itself, including the sign-in held by Clerk",
          ],
        ],
      },
      {
        kind: "p",
        text: "The local erase is not gated on being signed in, on purpose. The app has never required an account, so somebody who has never signed in still has a local history — and should not have to create an account, or delete one, in order to erase it.",
      },
      {
        kind: "p",
        text: "Deleting your account does not erase this iPhone's history unless you ask it to. The account deletion screen offers that as a separate, explicit choice, and defaults to keeping it. Your local record never left the phone, so the account has no claim on it, and an accidental deletion should cost you the account rather than your own record of what the app advised.",
      },
      {
        kind: "note",
        text: "There is no per-record delete. Earlier drafts of this policy described one; it was never built, and the claim has been removed rather than left to imply a control that is not there. What exists is the whole-store erase above.",
      },
    ],
  },
  {
    id: "rights",
    title: "Your rights under Canadian and Quebec law",
    blocks: [
      {
        kind: "p",
        text: "Canadian federal privacy law (PIPEDA) and, if you are in Quebec, Law 25 give you rights over your personal information. Where they apply to information on your own device, you exercise them yourself, immediately, without asking anyone. Where they apply to information on the server, write to me.",
      },
      {
        kind: "table",
        head: ["Right", "On your iPhone", "On the server"],
        rows: [
          [
            "Know what is held",
            "Listed in full above, and visible on screen in the app",
            "Listed above; the web hub shows a live count of every record type held for you",
          ],
          [
            "Access and portability",
            "No export control exists in the iOS app today. If one ships, this policy will say so",
            "The web hub exports your data as a structured file you can keep or take elsewhere",
          ],
          [
            "Correction",
            "Edit cards, settings, valuations, and merchant categories at any time",
            "Edit your records in the web hub, or write to me",
          ],
          [
            "Deletion",
            "Erase This iPhone's History, or delete the app",
            "Delete my data, or Delete account",
          ],
          [
            "Withdraw consent",
            "Turn off Location in iOS Settings",
            "Disconnect your email, revoke a Wallet Shortcut installation, or delete your account",
          ],
        ],
      },
      {
        kind: "note",
        text: "Earlier drafts said that a request for your data would find nothing to send. That was written when no server existed and is no longer true: if you have an account, I hold the information described above and can produce it.",
      },
      { kind: "sub", text: "A limitation about corrections, stated honestly" },
      {
        kind: "p",
        text: "The app deliberately never rewrites a recommendation after the fact. If a prediction was wrong, your correction is stored beside it rather than over it, so accuracy is measured against what you were actually told at the time rather than a tidied-up history. You can erase a prediction; you cannot silently edit one — and neither can I.",
      },
      { kind: "sub", text: "Automated decisions" },
      {
        kind: "p",
        text: "The recommendation engine makes automated calculations, but it does not make decisions about you: it does not score you, rank you, grant or refuse you anything, and nothing it produces has a legal or similarly significant effect. It tells you which card pays more and shows its arithmetic. If that ever changes, Law 25 requires that you be told, and you will be.",
      },
      { kind: "sub", text: "Where information is held" },
      {
        kind: "p",
        text: "The server and its database are operated through service providers who may store or process data outside Canada, including in the United States, where local authorities may be able to compel access under their own laws. Authentication is handled by Clerk. Information on your iPhone stays on your iPhone.",
      },
      { kind: "sub", text: "Breaches" },
      {
        kind: "p",
        text: "If a confidentiality incident occurs that presents a risk of serious injury, you will be notified, and the regulators will be notified, as PIPEDA and Law 25 require. I will not wait to be asked, and I will tell you what I actually know rather than a reassuring summary of it.",
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      {
        kind: "p",
        text: "On your iPhone, your data sits in the app's private storage area, protected by the iOS app sandbox and file protection. Those protections lean on your device having a passcode or biometric lock. If your iPhone has no passcode, its local data is much less protected — true of every app, including this one.",
      },
      {
        kind: "p",
        text: "On the server, traffic is encrypted in transit, sign-in is handled by Clerk rather than by hand-rolled password code, Wallet Shortcut tokens are stored only as hashes, and email credentials are encrypted at rest.",
      },
      {
        kind: "note",
        text: "What I do not claim: there has been no third-party security audit or certification, I hold no compliance certifications, and I will not describe any of this as bank-level or military-grade. It is a carefully built one-person system, which is a real thing but not the same thing as an audited one. You are entitled to weigh that.",
      },
    ],
  },
  {
    id: "children",
    title: "Children",
    blocks: [
      {
        kind: "p",
        text: "This is built for adults who hold credit cards. It is not directed at children, and I do not knowingly create accounts for them. If you believe a child has created an account, write to me and I will delete it.",
      },
    ],
  },
  {
    id: "advice",
    title: "Advice, not a guarantee",
    blocks: [
      {
        kind: "p",
        text: "Recommendations are calculated from a catalogue of published card terms and from your own settings. Card terms change, and merchants code purchases in ways nobody outside the payment network can see in advance. Each recommendation shows when its rules were last verified and how confident it is.",
      },
      {
        kind: "p",
        text: "It is a calculator you can audit, not a promise about what your issuer will pay you, and it is not financial advice.",
      },
    ],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    blocks: [
      {
        kind: "p",
        text: `Updated versions are posted at [${POLICY_URL}](${POLICY_URL}) with a new effective date.`,
      },
      {
        kind: "p",
        text: "If a future version ever collects something materially new, you will be told in the app or the web hub before it starts, and asked separately, rather than finding this page quietly rewritten. This version exists because an earlier draft had drifted out of step with the code; keeping the two aligned is the standard being held to here.",
      },
    ],
  },
  {
    id: "contact",
    title: "Contact, and how to complain",
    blocks: [
      {
        kind: "p",
        text: `Questions, or to exercise any right above: ${CONTACT_EMAIL}. This reaches ${PUBLISHER}, who is the person responsible for the protection of personal information.`,
      },
      {
        kind: "note",
        text: "No response-time commitment is published here, because a one-person project should not promise a service level it cannot guarantee. Statutory deadlines still apply: PIPEDA and Law 25 both require a response to an access request within thirty days.",
      },
      {
        kind: "p",
        text: "If you are not satisfied with how a request was handled, you can complain to a regulator, and you do not need permission to do so:",
      },
      {
        kind: "bullets",
        items: [
          "[Office of the Privacy Commissioner of Canada](https://www.priv.gc.ca/en/report-a-concern/)",
          "In Quebec, the [Commission d'acces a l'information du Quebec](https://www.cai.gouv.qc.ca/) — the Commission d'accès à l'information",
        ],
      },
    ],
  },
];
