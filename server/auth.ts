import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { db } from './db.js';
export type Identity = { uid: string; email: string; name: string; authTime: number };
declare global {
  namespace Express {
    interface Request {
      identity: Identity;
    }
  }
}
export function adminAuth() {
  if (!getApps().length) {
    if (!config.serviceAccount) throw new Error('Firebase server credentials are missing');
    initializeApp({ credential: cert(JSON.parse(readFileSync(config.serviceAccount, 'utf8'))) });
  }
  return getAuth();
}
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ') || header.length > 8192) {
      res.status(401).json({ error: 'Please sign in.' });
      return;
    }
    const token: DecodedIdToken = await adminAuth().verifyIdToken(header.slice(7), true);
    if (!token.email) {
      res.status(403).json({ error: 'An email account is required.' });
      return;
    }
    req.identity = {
      uid: token.uid,
      email: token.email,
      name: token.name || token.email.split('@')[0],
      authTime: token.auth_time,
    };
    await db.query(
      'INSERT INTO app_users(uid,email,name) VALUES($1,$2,$3) ON CONFLICT(uid) DO UPDATE SET email=excluded.email',
      [req.identity.uid, req.identity.email, req.identity.name],
    );
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}
