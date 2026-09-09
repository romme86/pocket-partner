import pg from 'pg';
import { config } from './config.js';
export const db = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
});
export type SQL = Pick<pg.PoolClient, 'query'>;
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
