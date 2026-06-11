import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyAccount(userId: string) {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: {
        accountNumber: true,
        currency: true,
        balance: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true, email: true, username: true } },
      },
    });

    if (!account) throw new NotFoundException('Account not found');
    return account;
  }
}
