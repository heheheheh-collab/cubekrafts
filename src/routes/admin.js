import { Router } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authenticateJWT } from "../middleware/auth.js";
import { format } from "fast-csv";

const router = Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cubekrafts2024";
const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const prisma = new PrismaClient();

// POST /api/admin/login
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
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
  } catch (err) {
    res.status(500).json({ error: "Failed to export inquiries." });
  }
});

export default router; 