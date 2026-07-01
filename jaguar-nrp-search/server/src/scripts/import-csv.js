// Imports a Jaguar NRP price list CSV into the local database.
// Usage: npm run import-csv -- /path/to/ItemsList.csv
//
// Expected columns: ItemCode,ItemName,SDP,NRP,Price,UnitCode,RangeCode,ColorCode
// Existing rows are matched by ItemCode and updated in place (upsert), so the
// same CSV (or an updated one) can be re-imported safely at any time.
//
// The source export has inconsistent/broken quoting in the ItemName column
// (unbalanced quotes, embedded newlines, embedded commas), so this uses a
// tolerant parser rather than a strict RFC4180 one: only ItemCode and the six
// trailing columns are relied on for structure, everything else is treated
// as ItemName with stray quote characters stripped.

import fs from "fs";
import { db } from "../db.js";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npm run import-csv -- /path/to/ItemsList.csv");
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(csvPath, "utf8");

// Splits the file into logical records, treating a newline as a record
// separator only when it's outside a (possibly malformed) quoted span.
function splitLogicalRecords(text) {
  const records = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === "\n" && !inQuotes) {
      records.push(current);
      current = "";
      continue;
    }
    if (ch === "\r") continue;
    current += ch;
  }
  if (current.trim()) records.push(current);
  return records;
}

function toNumber(v) {
  const n = Number(String(v).replace(/,/g, "").replace(/"/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseRecord(line) {
  const tokens = line.split(",");
  // ItemCode + 6 trailing columns (SDP, NRP, Price, UnitCode, RangeCode, ColorCode)
  if (tokens.length < 7) return null;

  const itemCode = tokens[0].replace(/"/g, "").trim();
  if (!itemCode) return null;

  const trailing = tokens.slice(-6);
  const itemName = tokens
    .slice(1, tokens.length - 6)
    .join(",")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const [sdp, nrp, price, unitCode, rangeCode, colorCode] = trailing;

  return {
    itemCode,
    itemName,
    sdp: toNumber(sdp),
    nrp: toNumber(nrp),
    price: toNumber(price),
    unitCode: unitCode.replace(/"/g, "").trim() || null,
    rangeCode: rangeCode.replace(/"/g, "").trim() || null,
    colorCode: colorCode.replace(/"/g, "").trim() || null,
  };
}

const [headerLine, ...dataLines] = splitLogicalRecords(raw);
if (!headerLine || !/itemcode/i.test(headerLine)) {
  console.error("Unexpected file format: first line does not look like a header row.");
  process.exit(1);
}

const upsert = db.prepare(`
  INSERT INTO products (item_code, item_name, sdp, nrp, price, unit_code, range_code, color_code, updated_at)
  VALUES (@itemCode, @itemName, @sdp, @nrp, @price, @unitCode, @rangeCode, @colorCode, datetime('now'))
  ON CONFLICT(item_code) DO UPDATE SET
    item_name = excluded.item_name,
    sdp = excluded.sdp,
    nrp = excluded.nrp,
    price = excluded.price,
    unit_code = excluded.unit_code,
    range_code = excluded.range_code,
    color_code = excluded.color_code,
    updated_at = excluded.updated_at
`);

let imported = 0;
let skipped = 0;

const importAll = db.transaction((lines) => {
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = parseRecord(line);
    if (!row) {
      skipped++;
      continue;
    }
    upsert.run(row);
    imported++;
  }
});

importAll(dataLines);

console.log(`Imported/updated ${imported} products from ${csvPath}.`);
if (skipped > 0) {
  console.log(`Skipped ${skipped} unparseable row(s).`);
}
