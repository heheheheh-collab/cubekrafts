import express from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import inquiriesRouter from "./routes/inquiries.js";
import adminRouter from "./routes/admin.js";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/node";

dotenv.config();

// Fail-fast: refuse to start if required secrets are missing or weak.
const requiredEnv = ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "ADMIN_JWT_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}
if (process.env.ADMIN_JWT_SECRET.length < 32) {
  console.error("ADMIN_JWT_SECRET must be at least 32 characters.");
  process.exit(1);
}

const app = express();
const prisma = new PrismaClient();

const sentryEnabled = Boolean(process.env.SENTRY_DSN);
if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV || "development",
  });
  // Request handler must be the first middleware on the app.
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// CORS allowlist from ALLOWED_ORIGINS (comma-separated). Requests with no Origin
// header (non-browser / same-origin) are allowed; cross-origin must be listed.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.get("/", (req, res) => {
  res.send("Cubekrafts API is running.");
});

app.use("/api/inquiries", inquiriesRouter);
app.use("/api/admin", adminRouter);

// Sentry error handler must come after routes and before the final handlers.
if (sentryEnabled) {
  app.use(Sentry.Handlers.errorHandler());
}

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: "Not found" });
});
// Global error handler — log detail server-side, return generic message in prod.
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";
  const message =
    isProd && status === 500
      ? "Internal server error"
      : err.message || "Internal server error";
  res.status(status).json({ error: message });
});
// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 