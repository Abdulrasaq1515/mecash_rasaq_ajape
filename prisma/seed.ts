import { PrismaClient, Currency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Exchange rates — both directions stored explicitly (no runtime division)
  await prisma.exchangeRate.createMany({
    data: [
      { fromCurrency: Currency.USD, toCurrency: Currency.NGN, rate: new Decimal('1400.0000000000') },
      { fromCurrency: Currency.NGN, toCurrency: Currency.USD, rate: new Decimal('0.0007142857') },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Exchange rates seeded (1 USD = ₦1,400)');

  // Pre-seeded accounts from spec (no user attached — transfer targets only)
  await prisma.account.upsert({
    where: { accountNumber: '1234567890' },
    update: {},
    create: {
      accountNumber: '1234567890',
      currency: Currency.NGN,
      balance: new Decimal('1000000.0000'),
      isSystem: true,
    },
  });

  await prisma.account.upsert({
    where: { accountNumber: '6574839201' },
    update: {},
    create: {
      accountNumber: '6574839201',
      currency: Currency.USD,
      balance: new Decimal('10000.0000'),
      isSystem: true,
    },
  });

  console.log('✅ Pre-seeded accounts created');
  console.log('   NGN account: 1234567890 (₦1,000,000)');
  console.log('   USD account: 6574839201 ($10,000)');
  console.log('✅ Seeding complete');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
