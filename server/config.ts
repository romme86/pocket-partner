import 'dotenv/config';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const positive = (key: string, fallback: number) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${key}`);
  return n;
};
export const config = {
  production: process.env.NODE_ENV === 'production',
  port: positive('PORT', 4174),
  base: '/pocket-partner',
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:4173',
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://pocket:pocket-local-only@127.0.0.1:55432/pocket',
  dataDir: resolve(process.env.DATA_DIR || 'data'),
  serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  firebaseWebFile: process.env.FIREBASE_WEB_CONFIG_FILE || '.private/firebase-web.json',
  elevenKey: process.env.ELEVENLABS_API_KEY || '',
  model: 'eleven_multilingual_v2',
  globalChars: positive('AI_MONTHLY_CHARACTERS', 10000),
  groupChars: positive('AI_GROUP_MONTHLY_CHARACTERS', 3000),
  groupStorage: positive('GROUP_STORAGE_BYTES', 100 * 1024 * 1024),
  globalStorage: positive('GLOBAL_STORAGE_BYTES', 1024 * 1024 * 1024),
  maxUpload: 10 * 1024 * 1024,
  maxRecordingSeconds: 180,
};
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
mkdirSync(resolve(config.dataDir, 'tmp'), { recursive: true, mode: 0o700 });
export function webConfig() {
  const value = JSON.parse(readFileSync(config.firebaseWebFile, 'utf8'));
  return {
    apiKey: value.apiKey,
    authDomain: value.authDomain,
    projectId: value.projectId,
    appId: value.appId,
  };
}
