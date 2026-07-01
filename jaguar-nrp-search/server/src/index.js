import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import "./db.js";
import authRouter from "./routes/auth.js";
import productsRouter from "./routes/products.js";

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is not set. Copy .env.example to .env and set a random secret.");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.get("/", (req, res) => {
  res.send("Jaguar NRP search API is running.");
});

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => {
  console.log(`Jaguar NRP search API listening on port ${PORT}`);
});
