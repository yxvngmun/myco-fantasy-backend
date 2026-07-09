# Fantasy Core API

Node/Express + PostgreSQL backend with session-based superadmin auth.

## Setup

```bash
cd server
npm install
cp .env.example .env
# edit .env with your real DATABASE_URL and a random SESSION_SECRET

npm run db:migrate   # creates tables
npm run db:seed      # seeds sports, global settings, 3 sample partners, and a superadmin login
npm run dev           # starts API on :4000
```

The seed script prints the superadmin login it created (defaults to
`admin@fantasycore.local` / `changeme123` unless overridden in `.env`).

## Endpoints

All routes except `/api/auth/login` require a valid session cookie.

- `POST /api/auth/login` `{ email, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/profile` `{ name?, email?, password? }`

- `GET /api/partners`
- `POST /api/partners`
- `PATCH /api/partners/:id`
- `DELETE /api/partners/:id`
- `GET /api/partners/check-subdomain?subdomain=foo`
- `GET /api/partners/export.csv`

- `GET /api/sports`
- `PATCH /api/sports/:key`

- `GET /api/settings`
- `PUT /api/settings`

- `GET /api/billing`
- `POST /api/billing/:partnerId/invoices`
- `GET /api/billing/:partnerId/invoices`

## Notes

- Sessions are stored in Postgres via `connect-pg-simple` (table `session`, created by the migration).
- CORS is locked to `CLIENT_ORIGIN` with `credentials: true` — the frontend must fetch with `credentials: "include"`.
- All money values are stored as `NUMERIC` and returned as JS numbers.
