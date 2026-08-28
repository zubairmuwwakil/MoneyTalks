import { prisma } from '../src/lib/prisma';

async function check() {
  const accountSnapshots = await prisma.investmentAccountSnapshot.findMany({
    where: { asOf: { gte: new Date('2026-08-27T00:00:00Z') } },
    include: { positions: true }
  });

  accountSnapshots.forEach(s => {
    console.log(`\nAccount ID: ${s.accountId} | Status: ${s.status} | AsOf: ${s.asOf}`);
    s.positions.forEach(p => {
        console.log(`  Position: ${p.symbol} | Qty: ${p.quantity} | Price: ${p.priceMinor} | ValuationComplete: ${p.valuationComplete} | PriceStatus: ${p.priceStatus} | PriceAsOf: ${p.priceAsOf}`);
    });
  });
  
  await prisma.$disconnect();
}

check();
