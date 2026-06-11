import { PrismaService } from '../../prisma/prisma.service';

/** Generates a unique random 10-digit account number */
export async function generateAccountNumber(prisma: PrismaService): Promise<string> {
  let accountNumber: string;
  let exists = true;

  while (exists) {
    // Ensures first digit is never 0 (realistic account numbers)
    const first = Math.floor(Math.random() * 9) + 1;
    const rest = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0');
    accountNumber = `${first}${rest}`;
    exists = !!(await prisma.account.findUnique({ where: { accountNumber } }));
  }

  return accountNumber!;
}
