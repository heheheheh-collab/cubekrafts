import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import { authenticateJWT } from "../middleware/auth.js";
import { format } from "fast-csv";

const router = Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const prisma = new PrismaClient();

// Strict, login-specific rate limit (separate from the global limiter).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

// POST /api/admin/login
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // Always run bcrypt.compare so response timing does not reveal whether the
  // username matched; bcrypt.compare is itself constant-time per call.
  const usernameMatch = username === ADMIN_USERNAME;
  const passwordMatch = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
  res.json({ token });
});

// GET /api/export (protected, CSV export)
router.get("/export", authenticateJWT, async (req, res) => {
  try {
    const inquiries = await prisma.inquiry.findMany({ orderBy: { createdAt: "desc" } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=export.csv");
    const csvStream = format({ headers: true });
    csvStream.pipe(res);
    inquiries.forEach(row => csvStream.write(row));
    csvStream.end();
    // Audit-log the bulk PII egress (admin identity + row count), matching the
    // pattern used for edit/delete in inquiries.js. inquiryId 0 = N/A (export).
    await prisma.auditLog.create({
      data: {
        action: "export",
        inquiryId: 0,
        admin: req.user?.username || "admin",
        details: JSON.stringify({ rowCount: inquiries.length }),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to export inquiries." });
  }
});

export default router; 