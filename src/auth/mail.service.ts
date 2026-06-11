import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get('MAIL_HOST'),
      port: config.get<number>('MAIL_PORT'),
      auth: {
        user: config.get('MAIL_USER'),
        pass: config.get('MAIL_PASS'),
      },
    });
  }

  async sendPasswordReset(to: string, token: string) {
    const resetUrl = `http://localhost:3000/api/v1/auth/reset-password?token=${token}`;
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM'),
        to,
        subject: 'meCash — Password Reset Request',
        html: `
          <p>You requested a password reset.</p>
          <p>Use this token to reset your password (valid for 15 minutes):</p>
          <code>${token}</code>
          <p>Or click: <a href="${resetUrl}">Reset Password</a></p>
          <p>If you did not request this, ignore this email.</p>
        `,
      });
    } catch (err) {
      // Log but don't throw — don't reveal mail failure to caller
      this.logger.error('Failed to send reset email', err);
    }
  }
}
