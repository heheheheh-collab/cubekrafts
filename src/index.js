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

const app = express();
const prisma = new PrismaClient();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || "development",
});

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(Sentry.Handlers.errorHandler());

app.get("/", (req, res) => {
  res.send("Cubekrafts API is running.");
});

app.use("/api/inquiries", inquiriesRouter);
app.use("/api/admin", adminRouter);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: "Not found" });
});
// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
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