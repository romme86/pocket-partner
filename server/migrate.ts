import { readFile } from 'node:fs/promises';
import { db } from './db.js';
await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
console.log('Database schema is ready.');
await db.end();
