# Cubekrafts Backend

This is the backend API for Cubekrafts, a modular construction platform.

> **Also in this repo:** Cold Trail, a multiplayer detective case game (separate project sharing this repository for now).
> - Play it: `npm run coldtrail` → http://localhost:5177 (login, solo/co-op/versus, daily case)
> - Design plan: [`docs/DETECTIVE_GAME_PLAN.md`](docs/DETECTIVE_GAME_PLAN.md)
> - Website (server + client): [`apps/`](apps/README.md)
> - Case generation engine: [`packages/case-engine`](packages/case-engine) — try `npm run case:generate -- --seed my-case --dossier case.md`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in values.
3. Run database migrations:
   ```bash
   npx prisma migrate dev --name init
   ```
4. Start the server:
   ```bash
   npm run dev
   ```

## Environment Variables
- `DATABASE_URL`: SQLite/Prisma DB connection string
- `ADMIN_JWT_SECRET`: Secret for admin JWT auth
- `PORT`: Server port (default 4000)

## API Endpoints
- `POST /api/inquiries`: Submit a contact/inquiry
- `GET /api/inquiries`: List all inquiries (admin)
- `GET /api/export`: Export inquiries as CSV (admin)

## Admin
- (Optional) JWT-based login for admin panel 
## Admin Login
- `POST /api/admin/login` with `{ username, password }` returns a JWT token
- Use `Authorization: Bearer <token>` header for protected endpoints 