import { createApp } from './app.js';
import { config, webConfig } from './config.js';
import { adminAuth } from './auth.js';
import { db } from './db.js';
webConfig();
adminAuth();
await db.query('SELECT 1');
const server = createApp().listen(config.port, '0.0.0.0', () =>
  console.log(`Pocket Partner listening on ${config.port}${config.base}/`),
);
server.requestTimeout = 120000;
server.headersTimeout = 30000;
process.on('SIGTERM', () => server.close(() => db.end().then(() => process.exit(0))));
