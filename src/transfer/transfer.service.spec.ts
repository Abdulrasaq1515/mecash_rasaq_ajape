import { Test } from '@nestjs/testing';
import { TransferService } from './transfer.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Currency, TransactionType, TransactionStatus } from '@prisma/client';

const mockNGNAccount = {
  id: 'acc-ngn-1',
  accountNumber: '1111111111',
  currency: Currency.NGN,
  balance: new Decimal('50000.0000'),
  userId: 'user-1',
  isSystem: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUSDAccount = {
  id: 'acc-usd-1',
  accountNumber: '2222222222',
  currency: Currency.USD,
  balance: new Decimal('100.0000'),
  userId: 'user-2',
  isSystem: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRate = {
  id: 'rate-1',
  fromCurrency: Currency.NGN,
  toCurrency: Currency.USD,
  rate: new Decimal('0.0007142857'),
  effectiveFrom: new Date(),
  effectiveTo: null,
  createdAt: new Date(),
};

const mockTx = {
  id: 'txn-1',
  reference: 'TXN-uuid',
  senderAccountId: mockNGNAccount.id,
  receiverAccountId: mockUSDAccount.id,
  senderAmount: new Decimal('140000.0000'),
  receiverAmount: new Decimal('100.00'),
  senderCurrency: Currency.NGN,
  receiverCurrency: Currency.USD,
  exchangeRate: new Decimal('0.0007142857'),
  type: TransactionType.CROSS_CURRENCY,
  status: TransactionStatus.SUCCESS,
  description: null,
  createdAt: new Date(),
  completedAt: new Date(),
};

describe('TransferService', () => {
  let service: TransferService;
  let prisma: jest.Mocked<PrismaService>;

  const buildPrismaMock = (overrides = {}) => ({
    account: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    exchangeRate: { findFirst: jest.fn() },
    transaction: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: PrismaService, useValue: buildPrismaMock() },
      ],
    }).compile();

    service = module.get(TransferService);
    prisma = module.get(PrismaService);
  });

  describe('transfer()', () => {
    it('should throw NotFoundException if sender has no account', async () => {
      (prisma.account.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(service.transfer('user-1', { toAccountNumber: '2222222222', amount: 100 }))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if receiver account does not exist', async () => {
      (prisma.account.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockNGNAccount)
        .mockResolvedValueOnce(null);
      await expect(service.transfer('user-1', { toAccountNumber: '9999999999', amount: 100 }))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on self-transfer', async () => {
      (prisma.account.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockNGNAccount)
        .mockResolvedValueOnce(mockNGNAccount); // same account
      await expect(service.transfer('user-1', { toAccountNumber: '1111111111', amount: 100 }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when amount converts to zero', async () => {
      (prisma.account.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockNGNAccount)
        .mockResolvedValueOnce(mockUSDAccount);
      (prisma.exchangeRate.findFirst as jest.Mock).mockResolvedValueOnce(mockRate);

      // ₦1 × 0.0007142857 = 0.0007... rounds to 0.00
      await expect(service.transfer('user-1', { toAccountNumber: '2222222222', amount: 1 }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for insufficient funds', async () => {
      (prisma.account.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockNGNAccount)
        .mockResolvedValueOnce(mockUSDAccount);
      (prisma.exchangeRate.findFirst as jest.Mock).mockResolvedValueOnce(mockRate);

      // $transaction callback invoked immediately
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ balance: '50000.0000' }]);
        return cb(prisma);
      });

      // amount > balance
      await expect(service.transfer('user-1', { toAccountNumber: '2222222222', amount: 999999 }))
        .rejects.toThrow(BadRequestException);
    });

    it('should complete a same-currency transfer successfully', async () => {
      const sameCurrencyReceiver = { ...mockNGNAccount, id: 'acc-ngn-2', accountNumber: '3333333333', userId: 'user-3' };
      (prisma.account.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockNGNAccount)
        .mockResolvedValueOnce(sameCurrencyReceiver);

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ balance: '50000.0000' }]);
        (prisma.account.update as jest.Mock).mockResolvedValue({});
        (prisma.transaction.create as jest.Mock).mockResolvedValue({
          ...mockTx,
          senderCurrency: Currency.NGN,
          receiverCurrency: Currency.NGN,
          type: TransactionType.SAME_CURRENCY,
          exchangeRate: null,
        });
        return cb(prisma);
      });

      const result = await service.transfer('user-1', { toAccountNumber: '3333333333', amount: 1000 });
      expect(result.type).toBe(TransactionType.SAME_CURRENCY);
      expect(result.status).toBe(TransactionStatus.SUCCESS);
    });

    it('should complete a cross-currency NGN→USD transfer', async () => {
      (prisma.account.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockNGNAccount)
        .mockResolvedValueOnce(mockUSDAccount);
      (prisma.exchangeRate.findFirst as jest.Mock).mockResolvedValueOnce(mockRate);

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb) => {
        (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ balance: '500000.0000' }]);
        (prisma.account.update as jest.Mock).mockResolvedValue({});
        (prisma.transaction.create as jest.Mock).mockResolvedValue(mockTx);
        return cb(prisma);
      });

      const result = await service.transfer('user-1', { toAccountNumber: '2222222222', amount: 140000 });
      expect(result.type).toBe(TransactionType.CROSS_CURRENCY);
      expect(result.receiverCurrency).toBe(Currency.USD);
    });
  });

  describe('getHistory()', () => {
    it('should return paginated transactions', async () => {
      (prisma.account.findUnique as jest.Mock).mockResolvedValueOnce(mockNGNAccount);
      (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([mockTx]);
      (prisma.transaction.count as jest.Mock).mockResolvedValueOnce(1);

      const result = await service.getHistory('user-1', 1, 20);
      expect(result.meta.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should cap limit at 100', async () => {
      (prisma.account.findUnique as jest.Mock).mockResolvedValueOnce(mockNGNAccount);
      (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.transaction.count as jest.Mock).mockResolvedValueOnce(0);

      await service.getHistory('user-1', 1, 9999);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
