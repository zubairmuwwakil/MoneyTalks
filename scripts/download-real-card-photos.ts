import fs from "fs";
import path from "path";

const outputDir = path.join(process.cwd(), "public", "cards");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Verified high-res transparent card photography URLs
const CARD_IMAGE_URLS: Record<string, string> = {
  "scotia-gold-amex": "https://milesopedia.com/wp-content/uploads/2026/02/Scotiabank-Amex-Gold-new-02-2026-EN-1.png",
  "scotia-momentum-vi-plus": "https://milesopedia.com/wp-content/uploads/2026/05/Momentum-Infinite-Plus-Chip-E-RGB-1.png",
  "scotia-passport-visa-infinite-plus": "https://milesopedia.com/wp-content/uploads/2026/05/SB-Visa-Infinite-Plus-chip-E-PMS-0326.png",
  "td-aeroplan-visa-infinite": "https://milesopedia.com/wp-content/uploads/2020/08/td-visa-infinite-aeroplan-new.png",
  "td-first-class-travel-visa-infinite": "https://milesopedia.com/wp-content/uploads/2024/05/td-first-class-travel-visa-infinite-card.webp",
  "td-cash-back-visa-infinite": "https://milesopedia.com/wp-content/uploads/2022/09/TD-Cash-Back-Visa-Infinite-Card.png",
  "bmo-eclipse-visa-infinite": "https://milesopedia.com/wp-content/uploads/2026/04/carte-bmo-eclipse-visa-infinite-exclusive-rect-EN.png",
  "bmo-ascend-world-elite": "https://milesopedia.com/wp-content/uploads/2026/05/BMO-Blue-Rewards-World-Elite-Mastercard.png",
  "national-bank-world-elite": "https://milesopedia.com/wp-content/uploads/2024/01/bnc-world-elite-EN-banque-nationale.png",
  "rogers-red-we": "https://milesopedia.com/wp-content/uploads/2025/10/Rogers-Red-World-Elite-Mastercard.png",
  "mbna-rewards-we": "https://milesopedia.com/wp-content/uploads/2024/01/MBNA-Rewards-World-Elite-Mastercard.png",
  "triangle-we": "https://milesopedia.com/wp-content/uploads/2021/01/canadian-tire-triangle-world-elite-mastercard.jpg",
  "cibc-dividend-visa-infinite": "https://milesopedia.com/wp-content/uploads/2021/09/CIBC_Dividend_Visa_infinite_front_eng.png",
  "cibc-aventura-visa-infinite": "https://milesopedia.com/wp-content/uploads/2021/09/CIBC_Aventura_Visa_Infinite_front_eng.png",
  "cibc-aventura-visa": "https://milesopedia.com/wp-content/uploads/2021/09/CIBC_Dividend_Visa_classic_front_eng.png",
  "rbc-avion-visa-infinite": "https://kqphqqvkrdovtyhdapud.supabase.co/storage/v1/object/public/media/2020/11/RBC-Avion.png",
  "rbc-ion-plus-visa": "https://milesopedia.com/wp-content/uploads/2024/06/RBC_AvionRewards_ION_Card_FRONT_RGB_ENG.webp",
  "amex-platinum": "https://kqphqqvkrdovtyhdapud.supabase.co/storage/v1/object/public/media/2020/06/AmexPlatinumCard.png",
  "amex-bonvoy": "https://milesopedia.com/wp-content/uploads/2020/09/carte-de-credit-marriot-bonvoy.png",
  "westjet-rbc-world-elite": "https://milesopedia.com/wp-content/uploads/2025/08/WestJet-RBC-World-Elite-Mastercard-for-Business-EN.png",
  "tangerine-moneyback-world": "https://milesopedia.com/wp-content/uploads/2026/04/tangerine-rewards-world-elite-mastercard.png",
};

async function downloadImage(cardId: string, url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      console.warn(`Failed to download ${cardId} from ${url}: HTTP ${response.status}`);
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Save as .png and .webp
    const pngPath = path.join(outputDir, `${cardId}.png`);
    const webpPath = path.join(outputDir, `${cardId}.webp`);
    
    fs.writeFileSync(pngPath, buffer);
    fs.writeFileSync(webpPath, buffer);
    
    console.log(`✓ Saved real photo for ${cardId} (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`Error downloading ${cardId}:`, err);
    return false;
  }
}

async function main() {
  console.log(`Starting real card photo download for ${Object.keys(CARD_IMAGE_URLS).length} cards...`);
  let count = 0;
  for (const [cardId, url] of Object.entries(CARD_IMAGE_URLS)) {
    const success = await downloadImage(cardId, url);
    if (success) count++;
  }
  console.log(`\nSuccessfully downloaded ${count} real card photos to ${outputDir}!`);
}

main().catch(console.error);
