# Cubekrafts Backend

This is the backend API for Cubekrafts, a modular construction platform.

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