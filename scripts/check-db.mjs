import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const accountSnapshots = await prisma.investmentAccountSnapshot.findMany({
    where: {
      date: { gte: new Date('2026-08-27T00:00:00Z') }
    },
    include: {
      positions: true
    }
  });

  console.log("Account Snapshots for Aug 27:");
  accountSnapshots.forEach(s => {
    console.log(`Account ID: ${s.accountId} | Status: ${s.status} | Date: ${s.date} | Positions: ${s.positions.length}`);
  });
  
  await prisma.$disconnect();
}

check();
