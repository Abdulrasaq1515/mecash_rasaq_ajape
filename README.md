# meCash — Multi-Currency Financial API

A production-grade REST API built with NestJS, supporting NGN and USD accounts, JWT authentication, cross-currency transfers with live exchange rates, and a secure password reset flow.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 + TypeScript |
| Database | PostgreSQL (Docker) |
| ORM | Prisma 5 |
| Auth | JWT (access + refresh tokens) via `@nestjs/jwt` + `passport-jwt` |
| Validation | `class-validator` + `class-transformer` |
| Password hashing | `bcryptjs` (12 rounds) |
| Email | `nodemailer` (Mailtrap in dev) |
| Rate limiting | `@nestjs/throttler` |
| Config | `@nestjs/config` (`.env`) |

---

## Setup

### 1. Start the database
```bash
docker-compose up -d
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```

Edit `.env` — the only value you must fill in for dev is Mailtrap credentials (free at https://mailtrap.io). Everything else has working defaults.

```env
DATABASE_URL="postgresql://mecash:mecash_secret@localhost:5432/mecash"

JWT_SECRET="your-jwt-secret"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="your-refresh-secret"
JWT_REFRESH_EXPIRES_IN="7d"

MAIL_HOST="sandbox.smtp.mailtrap.io"
MAIL_PORT=2525
MAIL_USER="your_mailtrap_user"
MAIL_PASS="your_mailtrap_pass"
MAIL_FROM="noreply@mecash.com"

NODE_ENV="development"
PORT=3000
```

### 4. Run migrations and seed
```bash
npm run db:migrate
npm run db:seed
```

### 5. Start the server
```bash
npm run start:dev
```

Server runs on `http://localhost:3000`

---

## API Endpoints

All successful responses are wrapped by the global `ResponseInterceptor`:
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-06-11T09:00:00.000Z"
}
```

All error responses follow:
```json
{
  "statusCode": 400,
  "timestamp": "2026-06-11T09:00:00.000Z",
  "path": "/api/v1/auth/login",
  "message": "Invalid credentials"
}
```

---

### Auth

#### POST `/api/v1/auth/register`

Creates a user and automatically opens a bank account (randomly NGN or USD).

**Body:**
```json
{
  "email": "user@example.com",
  "username": "john_doe",
  "firstName": "John",
  "lastName": "Doe",
  "password": "Secret@123",
  "confirmPassword": "Secret@123"
}
```

Password rules: min 8 chars, must contain uppercase, lowercase, digit, and special character (`@$!%*?&`).
Username rules: 3–30 chars, alphanumeric and underscores only.

**Response (201):**
```json
{
  "success": true,
  "data": {
    "message": "Account created successfully",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "john_doe",
      "firstName": "John",
      "lastName": "Doe"
    },
    "account": {
      "accountNumber": "8473920156",
      "currency": "NGN",
      "balance": "50000.0000"
    }
  }
}
```

Opening balances: ₦50,000 (NGN) or $100.00 (USD) — assigned randomly at registration.

---

#### POST `/api/v1/auth/login`

Rate limited to **5 attempts per minute per IP** (brute force protection).

**Body:**
```json
{
  "username": "john_doe",
  "password": "Secret@123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "tokenType": "Bearer"
  }
}
```

- `accessToken` expires in 15 minutes
- `refreshToken` expires in 7 days
- Both tokens are signed with separate secrets (`JWT_SECRET` and `JWT_REFRESH_SECRET`)

Use the `accessToken` in the `Authorization` header for protected routes:
```
Authorization: Bearer <accessToken>
```

**Security note:** Login is timing-safe — even if the username doesn't exist, `bcrypt.compare` still runs against a dummy hash to prevent timing attacks that could enumerate valid usernames.

---

#### POST `/api/v1/auth/forgot-password`

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "If this email is registered, you will receive a reset link"
  }
}
```

The response is always identical whether the email exists or not — prevents email enumeration.

**How the reset token works (two-layer approach):**

1. A cryptographically random 32-byte token is generated (`crypto.randomBytes(32)`)
2. The **raw token** is sent to the user's email (or returned in dev — see below)
3. A **SHA-256 hash** of the token is stored in the database — never the raw token
4. Token expires in **15 minutes**

This means even if the database is compromised, the stored hash cannot be used directly to reset passwords.

**In `NODE_ENV=development`**, the raw token is also returned in the response body so you can test without email access:
```json
{
  "success": true,
  "data": {
    "message": "If this email is registered, you will receive a reset link",
    "debug_reset_token": "a3f9c2e1b4d7..."
  }
}
```

---

#### POST `/api/v1/auth/reset-password`

**Body:**
```json
{
  "token": "a3f9c2e1b4d7...",
  "newPassword": "NewSecret@456",
  "confirmPassword": "NewSecret@456"
}
```

The API:
1. SHA-256 hashes the provided token
2. Looks up the hash in the DB — fails with the same error if not found or expired
3. Rejects if the new password is the same as the current one
4. Clears the reset token fields after a successful reset

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Password reset successful"
  }
}
```

---

### Account *(JWT required)*

#### GET `/api/v1/accounts/me`

Returns the authenticated user's account details and balance.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accountNumber": "8473920156",
    "currency": "NGN",
    "balance": "50000.0000",
    "createdAt": "2026-06-11T09:00:00.000Z",
    "user": {
      "firstName": "John",
      "lastName": "Doe",
      "email": "user@example.com",
      "username": "john_doe"
    }
  }
}
```

---

### Transfers *(JWT required)*

#### POST `/api/v1/transfers`

Sends money to another account. Supports same-currency and cross-currency transfers.

**Body:**
```json
{
  "toAccountNumber": "1234567890",
  "amount": 5000,
  "description": "Rent payment"
}
```

- `toAccountNumber` must be exactly 10 digits
- `amount` must be positive, max 2 decimal places
- `description` is optional, max 255 chars

**Response (201):**
```json
{
  "success": true,
  "data": {
    "reference": "TXN-uuid",
    "type": "SAME_CURRENCY",
    "senderAmount": "5000.0000",
    "senderCurrency": "NGN",
    "receiverAmount": "5000.0000",
    "receiverCurrency": "NGN",
    "exchangeRate": null,
    "description": "Rent payment",
    "status": "SUCCESS",
    "completedAt": "2026-06-11T09:00:00.000Z"
  }
}
```

**Cross-currency example** (NGN sender → USD receiver):
```json
{
  "toAccountNumber": "6574839201",
  "amount": 14000,
  "description": "Sending dollars"
}
```

Response will include:
```json
{
  "type": "CROSS_CURRENCY",
  "senderAmount": "14000.0000",
  "senderCurrency": "NGN",
  "receiverAmount": "10.00",
  "receiverCurrency": "USD",
  "exchangeRate": "0.0007142857"
}
```

**How the atomic transfer works:**

1. Sender and receiver accounts are loaded
2. Self-transfer is rejected
3. For cross-currency: the active exchange rate is fetched from the DB (`effectiveTo: null` = currently active), applied using `Decimal` arithmetic, and rounded using **banker's rounding** (ROUND_HALF_EVEN) to 2 decimal places
4. Inside a `prisma.$transaction()` block with `SELECT ... FOR UPDATE` on the sender's row — this locks the row at the DB level preventing double-spend under concurrent requests
5. Sender is debited, receiver is credited, transaction record is inserted — all atomically
6. If any step fails, all three DB operations are rolled back

---

#### GET `/api/v1/transfers/history`

Returns paginated transaction history (both sent and received).

**Query params:**
- `page` — default `1`
- `limit` — default `20`, max `100`

**Example:** `GET /api/v1/transfers/history?page=1&limit=10`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "data": [ ...transactions ],
    "meta": {
      "total": 45,
      "page": 1,
      "limit": 10,
      "totalPages": 5
    }
  }
}
```

---

## Pre-seeded Accounts (transfer targets for testing)

| Account Number | Currency | Balance |
|---|---|---|
| `1234567890` | NGN | ₦1,000,000 |
| `6574839201` | USD | $10,000 |

These are system accounts with no user attached — useful for testing transfers without needing a second registered user.

---

## Exchange Rates

Stored in the `exchange_rates` table, not hardcoded. Both directions are seeded explicitly:

| From | To | Rate |
|---|---|---|
| USD | NGN | 1400.0000000000 |
| NGN | USD | 0.0007142857 |

Both directions are stored separately to avoid runtime division rounding errors.

---

## Security Highlights

- Passwords hashed with bcrypt (12 rounds)
- Timing-safe login (prevents username enumeration)
- Reset tokens: raw token in email only, SHA-256 hash stored in DB
- Reset tokens expire in 15 minutes and are cleared after use
- Cannot reuse current password on reset
- `ValidationPipe` with `whitelist: true` strips unknown fields on every request
- Rate limiting: 60 req/min globally, 5 req/min on login
- `SELECT FOR UPDATE` prevents double-spend race conditions on transfers
- Banker's rounding (ROUND_HALF_EVEN) for financial precision
- Internal errors never leak details to the client in production

---

## Running Tests

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e
```

---

## Available Scripts

```bash
npm run start:dev     # dev server with hot reload
npm run build         # compile to dist/
npm run start:prod    # run compiled build
npm run db:migrate    # run Prisma migrations
npm run db:seed       # seed exchange rates + system accounts
npm run db:studio     # open Prisma Studio (DB GUI)
npm test              # run unit tests
npm run test:e2e      # run e2e tests
```
