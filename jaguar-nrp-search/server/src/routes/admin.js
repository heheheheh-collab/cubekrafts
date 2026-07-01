import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth-middleware.js";
import { importCsvText } from "../import-logic.js";

const router = Router();

router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB is comfortably more than the current export
});

// Lets a logged-in user (re)import the Jaguar NRP price list from inside the
// app, without needing shell/SCP access to wherever the server is deployed.
router.post("/import-csv", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  try {
    const raw = req.file.buffer.toString("utf8");
    const { imported, skipped } = importCsvText(raw);
    res.json({ imported, skipped });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to import CSV" });
  }
});

export default router;
