import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, MaxLength, Matches } from 'class-validator';

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'Account number must be exactly 10 digits' })
  toAccountNumber: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must have at most 2 decimal places' })
  @IsPositive({ message: 'Amount must be greater than zero' })
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class TransactionHistoryDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}
