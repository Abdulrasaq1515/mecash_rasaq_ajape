import {
  Injectable, BadRequestException, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransferDto } from './dto/transfer.dto';
import { roundMoney } from '../common/utils/rounding.util';
import { Decimal } from '@prisma/client/runtime/library';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class TransferService {
  constructor(private readonly prisma: PrismaService) {}

  async transfer(userId: string, dto: TransferDto) {
    // 1. Load sender account
    const senderAccount = await this.prisma.account.findUnique({ where: { userId } });
    if (!senderAccount) throw new NotFoundException('Sender account not found');

    // 2. Load receiver account
    const receiverAccount = await this.prisma.account.findUnique({
      where: { accountNumber: dto.toAccountNumber },
    });
    if (!receiverAccount) throw new NotFoundException('Destination account not found');

    // 3. Self-transfer guard
    if (senderAccount.id === receiverAccount.id) {
      throw new BadRequestException('Cannot transfer to your own account');
    }

    const senderAmount = new Decimal(dto.amount);
    const isCrossCurrency = senderAccount.currency !== receiverAccount.currency;

    // 4. Fetch exchange rate if cross-currency
    let exchangeRate: Decimal | null = null;
    let receiverAmount: Decimal;

    if (isCrossCurrency) {
      const rateRecord = await this.prisma.exchangeRate.findFirst({
        where: {
          fromCurrency: senderAccount.currency,
          toCurrency: receiverAccount.currency,
          effectiveTo: null, // currently active
        },
      });

      if (!rateRecord) {
        throw new UnprocessableEntityException(
          `No active exchange rate found for ${senderAccount.currency} → ${receiverAccount.currency}`,
        );
      }

      exchangeRate = rateRecord.rate;
      receiverAmount = roundMoney(senderAmount.mul(exchangeRate));

      // Guard: reject if conversion rounds to zero (amount too small)
      if (receiverAmount.equals(0)) {
        throw new BadRequestException(
          `Amount too small — converts to 0.00 ${receiverAccount.currency} after rounding`,
        );
      }
    } else {
      receiverAmount = senderAmount;
    }

    const reference = `TXN-${randomUUID()}`;
    const type = isCrossCurrency ? TransactionType.CROSS_CURRENCY : TransactionType.SAME_CURRENCY;

    // 5. Atomic DB transaction with SELECT FOR UPDATE to prevent race conditions
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock sender row — prevents double-spend under concurrent requests
      const locked = await tx.$queryRaw<{ balance: string }[]>`
        SELECT balance FROM accounts WHERE id = ${senderAccount.id} FOR UPDATE
      `;

      const currentBalance = new Decimal(locked[0].balance);

      if (currentBalance.lessThan(senderAmount)) {
        throw new BadRequestException('Insufficient funds');
      }

      // Debit sender
      await tx.account.update({
        where: { id: senderAccount.id },
        data: { balance: { decrement: senderAmount } },
      });

      // Credit receiver
      await tx.account.update({
        where: { id: receiverAccount.id },
        data: { balance: { increment: receiverAmount } },
      });

      // Insert immutable transaction record
      const transaction = await tx.transaction.create({
        data: {
          id: randomUUID(),
          reference,
          senderAccountId: senderAccount.id,
          receiverAccountId: receiverAccount.id,
          senderAmount,
          receiverAmount,
          senderCurrency: senderAccount.currency,
          receiverCurrency: receiverAccount.currency,
          exchangeRate,
          type,
          status: TransactionStatus.SUCCESS,
          description: dto.description ?? null,
          completedAt: new Date(),
        },
      });

      return transaction;
    });

    return {
      reference: result.reference,
      type: result.type,
      senderAmount: result.senderAmount,
      senderCurrency: result.senderCurrency,
      receiverAmount: result.receiverAmount,
      receiverCurrency: result.receiverCurrency,
      exchangeRate: result.exchangeRate,
      description: result.description,
      status: result.status,
      completedAt: result.completedAt,
    };
  }

  async getHistory(userId: string, page: number, limit: number) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20)); // cap at 100
    const skip = (safePage - 1) * safeLimit;

    const account = await this.prisma.account.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Account not found');

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          OR: [{ senderAccountId: account.id }, { receiverAccountId: account.id }],
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        select: {
          reference: true,
          type: true,
          senderAmount: true,
          senderCurrency: true,
          receiverAmount: true,
          receiverCurrency: true,
          exchangeRate: true,
          status: true,
          description: true,
          createdAt: true,
          completedAt: true,
          senderAccount: { select: { accountNumber: true } },
          receiverAccount: { select: { accountNumber: true } },
        },
      }),
      this.prisma.transaction.count({
        where: {
          OR: [{ senderAccountId: account.id }, { receiverAccountId: account.id }],
        },
      }),
    ]);

    return {
      data: transactions,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    };
  }
}
