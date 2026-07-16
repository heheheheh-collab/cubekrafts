// Tiny JSON-file persistence for users and finished-case results.
// Active game sessions are in-memory (see sessions.js); this is only the
// durable part. Swappable for Postgres/Prisma later without touching routes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  let data = { secret: null, users: [], results: [] };
  if (existsSync(file)) {
    try {
      data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      // corrupt db file — start fresh rather than crash the server
    }
  }
  if (!data.secret) data.secret = randomBytes(32).toString('hex');

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeFileSync(file, JSON.stringify(data, null, 2)), 50);
  };
  save();

  return {
    get secret() { return data.secret; },
    findUserByHandle(handle) {
      return data.users.find((u) => u.handle.toLowerCase() === handle.toLowerCase()) || null;
    },
    findUserById(id) {
      return data.users.find((u) => u.id === id) || null;
    },
    createUser(user) {
      data.users.push(user);
      save();
      return user;
    },
    addResult(result) {
      data.results.push(result);
      save();
      return result;
    },
    resultsFor(filter) {
      return data.results.filter(filter);
    },
  };
}
