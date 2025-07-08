import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateJWT } from "../middleware/auth.js";
import { body, validationResult } from "express-validator";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const router = Router();

const prisma = new PrismaClient();

const smtpTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendInquiryEmails({ name, email, location, message }) {
  // Confirmation to user
  await smtpTransport.sendMail({
    from: `Cubekrafts <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Thank you for your inquiry - Cubekrafts",
    text: `Dear ${name},\n\nThank you for reaching out to Cubekrafts! We have received your inquiry and will get in touch soon.\n\nYour message: ${message}\n\nBest regards,\nCubekrafts Team`,
  });
  // Notification to admin
  await smtpTransport.sendMail({
    from: `Cubekrafts <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: "New Inquiry Received - Cubekrafts",
    text: `New inquiry received:\n\nName: ${name}\nEmail: ${email}\nLocation: ${location}\nMessage: ${message}`,
  });
}

// POST /api/inquiries
router.post(
  "/",
  [
    body("name").isLength({ min: 2 }).withMessage("Name is required."),
    body("email").isEmail().withMessage("Valid email is required."),
    body("location").notEmpty().withMessage("Location is required."),
    body("message").isLength({ min: 5 }).withMessage("Message is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { name, email, location, message } = req.body;
    try {
      const inquiry = await prisma.inquiry.create({
        data: { name, email, location, message },
      });
      try {
        await sendInquiryEmails({ name, email, location, message });
      } catch (e) {
        // Log but don't fail the request if email fails
        console.error("Failed to send inquiry emails:", e);
      }
      res.status(201).json(inquiry);
    } catch (err) {
      res.status(500).json({ error: "Failed to create inquiry." });
    }
  }
);

// GET /api/inquiries (protected, with pagination and search)
router.get("/", authenticateJWT, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const q = req.query.q?.trim();
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
            { message: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};
    const total = await prisma.inquiry.count({ where });
    const inquiries = await prisma.inquiry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    res.json({ total, page, pageSize, inquiries });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch inquiries." });
  }
});

// PATCH /api/inquiries/:id (admin only)
router.patch(
  "/:id",
  authenticateJWT,
  [
    body("name").isLength({ min: 2 }).withMessage("Name is required."),
    body("email").isEmail().withMessage("Valid email is required."),
    body("location").notEmpty().withMessage("Location is required."),
    body("message").isLength({ min: 5 }).withMessage("Message is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { name, email, location, message } = req.body;
    const { id } = req.params;
    try {
      const before = await prisma.inquiry.findUnique({ where: { id: Number(id) } });
      const inquiry = await prisma.inquiry.update({
        where: { id: Number(id) },
        data: { name, email, location, message },
      });
      await prisma.auditLog.create({
        data: {
          action: "edit",
          inquiryId: Number(id),
          admin: req.user?.username || "admin",
          details: JSON.stringify({ before, after: inquiry }),
        },
      });
      res.json(inquiry);
    } catch (err) {
      res.status(500).json({ error: "Failed to update inquiry." });
    }
  }
);

// DELETE /api/inquiries/:id (admin only)
router.delete("/:id", authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await prisma.inquiry.findUnique({ where: { id: Number(id) } });
    await prisma.inquiry.delete({ where: { id: Number(id) } });
    await prisma.auditLog.create({
      data: {
        action: "delete",
        inquiryId: Number(id),
        admin: req.user?.username || "admin",
        details: JSON.stringify({ deleted }),
      },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete inquiry." });
  }
});

export default router; 