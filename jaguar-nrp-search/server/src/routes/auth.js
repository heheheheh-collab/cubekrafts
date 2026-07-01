import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";
import { issueSessionCookie, clearSessionCookie, requireAuth } from "../auth-middleware.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

const getUser = db.prepare("SELECT * FROM users WHERE username = ?");
const insertUser = db.prepare(
  "INSERT INTO users (username, password_hash) VALUES (?, ?)"
);
const logAttempt = db.prepare(
  "INSERT INTO login_attempts (ip, username, success) VALUES (?, ?, ?)"
);

router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = getUser.get(username);
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

  logAttempt.run(req.ip, username, valid ? 1 : 0);

  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  issueSessionCookie(res, user);
  res.json({ username: user.username });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

// Only someone who is already logged in can create another account -
// there is no public self-signup for this site.
router.post("/create-user", requireAuth, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required" });
  }
  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    insertUser.run(trimmedUsername, passwordHash);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "SQLITE_CONSTRAINT") {
      return res.status(409).json({ error: "That username already exists" });
    }
    throw err;
  }

  res.status(201).json({ username: trimmedUsername });
});

export default router;
