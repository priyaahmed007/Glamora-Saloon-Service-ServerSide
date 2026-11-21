# Glamora Server (API)

REST API for **Glamora**, a salon appointment booking platform. Customers browse services, request appointments and pay for confirmed bookings through Stripe. The salon admin manages services, appointments, customers and payments.

- **Live website:** https://glamora-saloon-service.vercel.app
- **Client repository:** https://github.com/priyaahmed007/Glamora-Saloon-Service-ClientSide.git
- **Server repository:** https://github.com/priyaahmed007/Glamora-Saloon-Service-ServerSide.git

## Important Features

- Better Auth (email/password + Google) running on this Express server
- JWT verification middleware (Better Auth JWT plugin, verified with the server's JWKS)
- Server-side role checks (`admin` / `customer`) on every protected route
- Blocked users are rejected on every protected route and their sessions are removed
- Services CRUD with search, category filter, price sorting and pagination
- Appointment booking with race-safe double-booking protection (unique index on active slots)
- Stripe Checkout; payment status is changed **only** by a verified Stripe webhook
- ImgBB image uploads (API key stays on the server)
- Centralised error handling, Helmet, CORS allow-list and rate limiting on public uploads

## Technology Stack

Node.js, Express.js, MongoDB (native driver), Better Auth, jose (JWT), Stripe, Multer, ImgBB.

## Database Collections

| Collection | Purpose |
|---|---|
| `users` | Managed by Better Auth (`name, email, image, role, isBlocked, phone`) |
| `services` | `serviceName, category, description, price, duration, image, status, createdAt` |
| `appointments` | `serviceId, customerId, appointmentDate, timeSlot, message, servicePrice, paymentStatus, status, createdAt` |
| `transactions` | `appointmentId, customerId, amount, currency, stripeSessionId, status, createdAt` |

Better Auth also keeps its own `session`, `account`, `verification` and `jwks` collections.

Booking rule: a service can have only one active (pending/confirmed) appointment per date and time slot, and a customer cannot hold two active appointments at the same date and time.

## Installation Instructions

```bash
cd glamora-server
npm install
```

## Required Environment Variables

Copy `.env.example` to `.env` and fill in the values (names only are listed here).

```
PORT
NODE_ENV
CLIENT_URL
COOKIE_DOMAIN
NEXT_PUBLIC_API_URL
MONGODB_URI
MONGODB_DB
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
IMGBB_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
BETTER_AUTH_URL
BETTER_AUTH_SECRET
```

`BETTER_AUTH_SECRET` should be a long random string (`openssl rand -base64 32`). Never commit `.env`.

## How to Run the Project Locally

```bash
npm run seed   # creates the admin, a demo customer and sample services
npm run dev    # starts http://localhost:8000
```

Seeded accounts: `admin@glamora.com / Admin@123` and `customer@glamora.com / Customer@123`
(override the admin with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` when running the seed). Change the admin password for production. Admin accounts cannot be created through public sign-up: the `role` field is not accepted as input.

### Google OAuth

In Google Cloud Console add the redirect URI `BETTER_AUTH_URL/api/auth/callback/google` (for local: `http://localhost:8000/api/auth/callback/google`).

### Stripe webhook (local)

```bash
stripe listen --forward-to localhost:8000/api/payments/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`. In production create a webhook endpoint `https://YOUR-SERVER-URL/api/payments/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Use test card `4242 4242 4242 4242`.

## API Overview

| Method | Route | Access |
|---|---|---|
| GET | `/api/services`, `/api/services/categories` | Public |
| GET | `/api/services/:id` | Authenticated |
| GET/POST/PUT/PATCH/DELETE | `/api/services...` (admin routes) | Admin |
| POST | `/api/appointments` | Customer |
| GET | `/api/appointments/my`, `/booked-slots`, `/:id` | Customer (own) |
| GET | `/api/appointments` | Admin |
| PATCH | `/api/appointments/:id/confirm` | Admin |
| PATCH | `/api/appointments/:id/cancel` | Customer (own pending) / Admin |
| POST | `/api/payments/checkout/:appointmentId` | Customer |
| POST | `/api/payments/webhook` | Stripe (signature verified) |
| GET | `/api/payments/my`, `/api/payments/transactions` | Customer / Admin |
| GET/PATCH | `/api/users/me` | Authenticated |
| GET/PATCH | `/api/users`, `/:id/block`, `/:id/unblock` | Admin |
| GET | `/api/stats/customer`, `/api/stats/admin` | Customer / Admin |
| POST | `/api/upload/avatar`, `/api/upload/service` | Public (rate limited) / Admin |

## Deployment Notes

- Set `NODE_ENV=production`, `CLIENT_URL` to your live client URL and `BETTER_AUTH_URL` to your live server URL.
- Cross-site cookies use `SameSite=None; Secure` in production. For the most reliable sessions put client and server on sibling sub-domains of one domain (for example `app.example.com` and `api.example.com`) and set `COOKIE_DOMAIN=.example.com`.
- A long-running host such as Render or Railway (`npm start`) is recommended for the Stripe webhook. A `vercel.json` + `api/index.js` is included if you prefer Vercel.
- Add your MongoDB Atlas network access rule for the host's IP (or `0.0.0.0/0` for testing).
