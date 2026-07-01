// Imports a Jaguar NRP price list CSV into the local database.
// Usage: npm run import-csv -- /path/to/ItemsList.csv
//
// Expected columns: ItemCode,ItemName,SDP,NRP,Price,UnitCode,RangeCode,ColorCode
// Existing rows are matched by ItemCode and updated in place (upsert), so the
// same CSV (or an updated one) can be re-imported safely at any time.
//
// This is also available from inside the running app (once logged in) via
// the "Import CSV" page, which is useful when the server is deployed
// somewhere without shell access to the machine.

import fs from "fs";
import { importCsvText } from "../import-logic.js";

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
const { imported, skipped } = importCsvText(raw);

console.log(`Imported/updated ${imported} products from ${csvPath}.`);
if (skipped > 0) {
  console.log(`Skipped ${skipped} unparseable row(s).`);
}
