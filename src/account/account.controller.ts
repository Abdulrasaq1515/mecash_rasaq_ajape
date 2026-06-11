import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountService } from './account.service';

@Controller('api/v1/accounts')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('me')
  getMyAccount(@CurrentUser() user: { id: string }) {
    return this.accountService.getMyAccount(user.id);
  }
}
