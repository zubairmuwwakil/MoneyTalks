import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

async function main() {
  // Use the exact path requested by the user
  const sourcePath = "/Users/zub/Documents/Github_Projects/PickMe/Engine/Sources/CardCopilotEngine/Resources/owner-state.json";
  
  if (!fs.existsSync(sourcePath)) {
    console.error(`File not found: ${sourcePath}`);
    process.exit(1);
  }

  const stateData = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  
  // Owner state is per-user now — require an explicit target.
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx scripts/seed-owner-state.ts <user-email>");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}.`);
    process.exit(1);
  }

  await prisma.ownerStateRecord.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      stateData,
    },
    update: {
      stateData,
    }
  });

  console.log(`Successfully seeded owner state for user ${user.id}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
