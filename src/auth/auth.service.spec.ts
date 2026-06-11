import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User',
  passwordHash: '$2b$12$hashedpassword',
  resetToken: null,
  resetTokenExpires: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            account: { findUnique: jest.fn() },
          },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('mock.jwt.token') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => {
            const map: Record<string, string> = {
              JWT_SECRET: 'secret', JWT_EXPIRES_IN: '15m',
              JWT_REFRESH_SECRET: 'refresh', JWT_REFRESH_EXPIRES_IN: '7d',
              NODE_ENV: 'development',
            };
            return map[key];
          })},
        },
        {
          provide: MailService,
          useValue: { sendPasswordReset: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  describe('register()', () => {
    const registerDto = {
      email: 'new@example.com',
      username: 'newuser',
      firstName: 'New',
      lastName: 'User',
      password: 'Password1@',
      confirmPassword: 'Password1@',
    };

    it('should throw if passwords do not match', async () => {
      await expect(service.register({ ...registerDto, confirmPassword: 'Wrong1@' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if email already exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(mockUser).mockResolvedValueOnce(null);
      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if username already exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(mockUser);
      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should create user and account on valid input', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      prisma.account = { findUnique: jest.fn().mockResolvedValue(null) };
      prisma.user.create.mockResolvedValue({
        ...mockUser,
        email: registerDto.email,
        username: registerDto.username,
        account: { accountNumber: '1234567890', currency: 'NGN', balance: '50000.0000' },
      });

      const result = await service.register(registerDto);
      expect(result.message).toBe('Account created successfully');
      expect(result.user.email).toBe(registerDto.email);
    });
  });

  describe('login()', () => {
    it('should throw UnauthorizedException for unknown username', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.login({ username: 'nobody', password: 'pass' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.login({ username: 'testuser', password: 'wrong' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.login({ username: 'testuser', password: 'Password1@' });
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.tokenType).toBe('Bearer');
    });
  });

  describe('forgotPassword()', () => {
    it('should return generic message regardless of whether email exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword({ email: 'nobody@example.com' });
      expect(result.message).toContain('If this email is registered');
    });

    it('should return debug_reset_token in development', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({});
      const result = await service.forgotPassword({ email: mockUser.email });
      expect(result).toHaveProperty('debug_reset_token');
    });
  });

  describe('resetPassword()', () => {
    it('should throw if passwords do not match', async () => {
      await expect(
        service.resetPassword({ token: 'tok', newPassword: 'NewPass1@', confirmPassword: 'Different1@' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if token is invalid or expired', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.resetPassword({ token: 'badtoken', newPassword: 'NewPass1@', confirmPassword: 'NewPass1@' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if new password is same as old password', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true); // same password
      await expect(
        service.resetPassword({ token: 'valid', newPassword: 'NewPass1@', confirmPassword: 'NewPass1@' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update password on valid token', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      (bcrypt.hash as jest.Mock).mockResolvedValue('newhash');
      prisma.user.update.mockResolvedValue({});
      const result = await service.resetPassword({ token: 'valid', newPassword: 'NewPass1@', confirmPassword: 'NewPass1@' });
      expect(result.message).toBe('Password reset successful');
    });
  });
});
