import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TransferService } from './transfer.service';
import { TransferDto } from './dto/transfer.dto';

@Controller('api/v1/transfers')
@UseGuards(JwtAuthGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  transfer(@CurrentUser() user: { id: string }, @Body() dto: TransferDto) {
    return this.transferService.transfer(user.id, dto);
  }

  @Get('history')
  getHistory(
    @CurrentUser() user: { id: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.transferService.getHistory(user.id, +page, +limit);
  }
}
