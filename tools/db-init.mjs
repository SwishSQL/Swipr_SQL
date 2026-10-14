// npm run db:init — creates every table / index / view of sql/schema.sql (idempotent). Needs the owner of the database.
import { initDatabase, pool } from '../db.js';
const n = await initDatabase({ createDatabase: process.argv.includes('--create-database') });
console.log(`schema applied (${n} batches)`);
await pool.end();
