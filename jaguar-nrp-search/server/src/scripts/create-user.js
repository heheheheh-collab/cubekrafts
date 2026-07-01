// Creates or updates a login account for the search site.
// Usage: npm run create-user -- <username> <password>
//
// Passwords are hashed with bcrypt before being stored; the plaintext
// password is never written to disk or logged anywhere.

import bcrypt from "bcryptjs";
import { db } from "../db.js";

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error("Usage: npm run create-user -- <username> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);

db.prepare(
  `INSERT INTO users (username, password_hash) VALUES (?, ?)
   ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`
).run(username, passwordHash);

console.log(`User "${username}" created/updated successfully.`);
