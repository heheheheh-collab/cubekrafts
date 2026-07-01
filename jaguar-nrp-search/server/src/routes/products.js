import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../auth-middleware.js";

const router = Router();

// All product data is proprietary Jaguar pricing info, so every route here
// requires an authenticated session.
router.use(requireAuth);

const MAX_PAGE_SIZE = 100;

router.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const rangeCode = typeof req.query.rangeCode === "string" ? req.query.rangeCode.trim().slice(0, 20) : "";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

  const clauses = [];
  const params = {};

  if (q) {
    clauses.push("(item_code LIKE @like OR item_name LIKE @like OR color_code LIKE @like)");
    params.like = `%${q}%`;
  }
  if (rangeCode) {
    clauses.push("range_code = @rangeCode");
    params.rangeCode = rangeCode;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const total = db.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).get(params).count;
  const products = db
    .prepare(
      `SELECT item_code AS itemCode, item_name AS itemName, nrp, price,
              unit_code AS unitCode, range_code AS rangeCode, color_code AS colorCode
       FROM products
       ${where}
       ORDER BY item_name ASC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

  res.json({ total, page, pageSize, products });
});

router.get("/ranges", (req, res) => {
  const ranges = db
    .prepare("SELECT DISTINCT range_code AS rangeCode FROM products WHERE range_code IS NOT NULL ORDER BY range_code ASC")
    .all()
    .map((r) => r.rangeCode);
  res.json({ ranges });
});

export default router;
