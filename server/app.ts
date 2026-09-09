import express, { type RequestHandler, type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, unlink, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, webConfig } from './config.js';
import { db, transaction } from './db.js';
import { authenticate, adminAuth } from './auth.js';
import {
  AppError,
  member,
  lineAccess,
  sceneAccess,
  saveFile,
  convertRecording,
  runFile,
  removeUnusedIds,
} from './storage.js';
import { parseScript, colorFor } from './parser.js';
import { voices } from './voices.js';
import { enqueueGeneration, budgetFor } from './generation.js';
const id = z.string().uuid();
const title = z.string().trim().min(1).max(160);
const name = z.string().trim().min(1).max(60);
const lineSchema = z.object({
  speaker: z.string().trim().min(1).max(60).nullable(),
  text: z.string().min(1).max(12000),
});
const sceneSchema = z.object({ title, lines: z.array(lineSchema).min(1).max(1000) });
const upload = multer({
  dest: resolve(config.dataDir, 'tmp'),
  limits: { fileSize: config.maxUpload, files: 1, fields: 8, fieldSize: 1024 * 1024 },
});
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const editor: RequestHandler = async (req, _res, next) => {
  try {
    await member(db, String(req.params.groupId), req.identity.uid, ['owner', 'editor']);
    next();
  } catch (e) {
    next(e);
  }
};
const owner: RequestHandler = async (req, _res, next) => {
  try {
    await member(db, String(req.params.groupId), req.identity.uid, ['owner']);
    next();
  } catch (e) {
    next(e);
  }
};
export function createApp(auth: RequestHandler = authenticate) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: [
            "'self'",
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://www.googleapis.com',
            'https://firebase.googleapis.com',
          ],
          frameSrc: ["'self'", 'https://*.firebaseapp.com'],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.get(config.base + '/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });
  app.get(config.base + '/api/config', (_req, res) => res.json({ firebase: webConfig() }));
  const api = express.Router();
  app.use(config.base + '/api', api);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(rateLimit({ windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  api.use((req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.origin
    ) {
      res.status(403).json({ error: 'This request came from another website.' });
      return;
    }
    next();
  });
  api.use(auth);
  api.use(
    rateLimit({
      windowMs: 60000,
      limit: 180,
      keyGenerator: (req) => req.identity.uid,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  api.get('/me', async (req, res) => {
    const { rows: groups } = await db.query(
      'SELECT g.*,m.role FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.uid=$1 ORDER BY g.created_at',
      [req.identity.uid],
    );
    const { rows: users } = await db.query('SELECT uid,email,name FROM app_users WHERE uid=$1', [
      req.identity.uid,
    ]);
    res.json({ user: users[0], groups });
  });
  api.patch('/me', async (req, res) => {
    const body = z.object({ name }).parse(req.body);
    await db.query('UPDATE app_users SET name=$2 WHERE uid=$1', [req.identity.uid, body.name]);
    await adminAuth().updateUser(req.identity.uid, { displayName: body.name });
    res.json({ ok: true });
  });
  api.delete('/me', async (req, res) => {
    if (Date.now() / 1000 - req.identity.authTime > 300)
      throw new AppError(401, 'Sign in again before deleting your account.');
    const { rows } = await db.query('SELECT id FROM groups WHERE owner_uid=$1', [req.identity.uid]);
    if (rows.length) throw new AppError(409, 'Delete your groups before deleting your account.');
    await adminAuth().deleteUser(req.identity.uid);
    await db.query('DELETE FROM app_users WHERE uid=$1', [req.identity.uid]);
    res.json({ ok: true });
  });
  api.post('/groups', async (req, res) => {
    const body = z.object({ name }).parse(req.body);
    const groupId = randomUUID();
    await transaction(async (c) => {
      await c.query('SELECT uid FROM app_users WHERE uid=$1 FOR UPDATE', [req.identity.uid]);
      const n = await c.query('SELECT count(*) FROM groups WHERE owner_uid=$1', [req.identity.uid]);
      if (Number(n.rows[0].count) >= 10)
        throw new AppError(429, 'You can create up to 10 groups in this MVP.');
      await c.query('INSERT INTO groups(id,name,owner_uid) VALUES($1,$2,$3)', [
        groupId,
        body.name,
        req.identity.uid,
      ]);
      await c.query("INSERT INTO memberships VALUES($1,$2,'owner')", [groupId, req.identity.uid]);
    });
    res.status(201).json({ id: groupId });
  });
  api.get('/groups/:groupId', async (req, res) => {
    const groupId = id.parse(req.params.groupId);
    const role = await member(db, groupId, req.identity.uid);
    const { rows: members } = await db.query(
      "SELECT u.uid,u.name,u.email,m.role FROM memberships m JOIN app_users u ON u.uid=m.uid WHERE m.group_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.name",
      [groupId],
    );
    const { rows: scripts } = await db.query(
      `SELECT p.*, (SELECT count(*)::int FROM scenes s WHERE s.script_id=p.id) AS scene_count, (SELECT count(*)::int FROM characters c WHERE c.script_id=p.id) AS character_count FROM scripts p WHERE p.group_id=$1 ORDER BY p.created_at DESC`,
      [groupId],
    );
    const invitations =
      role === 'owner'
        ? (
            await db.query(
              'SELECT id,role,expires_at,used_at,revoked_at FROM invitations WHERE group_id=$1 ORDER BY created_at DESC LIMIT 30',
              [groupId],
            )
          ).rows
        : [];
    res.json({ role, members, scripts, invitations, budget: await budgetFor(groupId) });
  });
  api.patch('/groups/:groupId', owner, async (req, res) => {
    const body = z.object({ name }).parse(req.body);
    await db.query('UPDATE groups SET name=$2 WHERE id=$1', [req.params.groupId, body.name]);
    res.json({ ok: true });
  });
  api.delete('/groups/:groupId', owner, async (req, res) => {
    const { rows } = await db.query('SELECT storage_name FROM files WHERE group_id=$1', [
      req.params.groupId,
    ]);
    await db.query('DELETE FROM groups WHERE id=$1', [req.params.groupId]);
    for (const f of rows) await unlink(resolve(config.dataDir, f.storage_name)).catch(() => {});
    res.json({ ok: true });
  });
  api.patch('/groups/:groupId/members/:uid', owner, async (req, res) => {
    const body = z.object({ role: z.enum(['editor', 'member']) }).parse(req.body);
    if (req.params.uid === req.identity.uid)
      throw new AppError(400, 'The owner role cannot be changed here.');
    await db.query(
      "UPDATE memberships SET role=$3 WHERE group_id=$1 AND uid=$2 AND role<>'owner'",
      [req.params.groupId, req.params.uid, body.role],
    );
    res.json({ ok: true });
  });
  api.delete('/groups/:groupId/members/:uid', owner, async (req, res) => {
    if (req.params.uid === req.identity.uid)
      throw new AppError(400, 'Delete the group to remove its owner.');
    await db.query("DELETE FROM memberships WHERE group_id=$1 AND uid=$2 AND role<>'owner'", [
      req.params.groupId,
      req.params.uid,
    ]);
    res.json({ ok: true });
  });
  api.post('/groups/:groupId/invitations', owner, async (req, res) => {
    const body = z.object({ role: z.enum(['editor', 'member']) }).parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const inviteId = randomUUID();
    await db.query(
      "INSERT INTO invitations(id,group_id,token_hash,role,created_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')",
      [inviteId, req.params.groupId, hash(token), body.role, req.identity.uid],
    );
    res.json({ id: inviteId, url: config.origin + config.base + '/#invite/' + token });
  });
  api.delete('/groups/:groupId/invitations/:id', owner, async (req, res) => {
    await db.query('UPDATE invitations SET revoked_at=now() WHERE id=$1 AND group_id=$2', [
      id.parse(req.params.id),
      req.params.groupId,
    ]);
    res.json({ ok: true });
  });
  api.get('/invitations/:token', async (req, res) => {
    const token = z.string().min(40).max(60).parse(req.params.token);
    const { rows } = await db.query(
      'SELECT g.name,i.role FROM invitations i JOIN groups g ON g.id=i.group_id WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()',
      [hash(token)],
    );
    if (!rows.length) throw new AppError(404, 'This invitation has expired or already been used.');
    res.json(rows[0]);
  });
  api.post('/invitations/:token/accept', async (req, res) => {
    const token = z.string().min(40).max(60).parse(req.params.token);
    const groupId = await transaction(async (c) => {
      const { rows } = await c.query(
        'SELECT * FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',
        [hash(token)],
      );
      if (!rows.length)
        throw new AppError(404, 'This invitation has expired or already been used.');
      const invite = rows[0];
      await c.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE', [invite.group_id]);
      const members = await c.query('SELECT count(*) FROM memberships WHERE group_id=$1', [
        invite.group_id,
      ]);
      if (Number(members.rows[0].count) >= 30)
        throw new AppError(409, 'This group has reached its 30-member limit.');
      await c.query(
        'INSERT INTO memberships(group_id,uid,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [invite.group_id, req.identity.uid, invite.role],
      );
      await c.query('UPDATE invitations SET used_at=now() WHERE id=$1', [invite.id]);
      return invite.group_id;
    });
    res.json({ groupId });
  });
  const uploadLimiter = rateLimit({
    windowMs: 60000,
    limit: 10,
    keyGenerator: (req) => req.identity.uid,
    standardHeaders: true,
    legacyHeaders: false,
  });
  api.post(
    '/groups/:groupId/import-preview',
    editor,
    uploadLimiter,
    upload.single('file'),
    async (req, res) => {
      let text = String(req.body.text || '');
      let fileId: string | null = null;
      try {
        if (req.file) {
          const buffer = await readFile(req.file.path);
          if (buffer.subarray(0, 5).toString() === '%PDF-') {
            const output = await runFile(
              'pdftotext',
              ['-layout', '-enc', 'UTF-8', req.file.path, '-'],
              { timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
            );
            text = output.stdout;
          } else {
            if (!req.file.originalname.toLowerCase().endsWith('.txt') || buffer.includes(0))
              throw new AppError(400, 'Choose a text-based PDF or UTF-8 TXT file.');
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
          }
          if (!text.trim())
            throw new AppError(
              400,
              'No text was found. Scanned PDFs need OCR; paste the scene text instead.',
            );
          fileId = await saveFile(
            String(req.params.groupId),
            buffer,
            buffer.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : 'text/plain',
            req.file.originalname,
          );
        }
        text = z.string().min(1).max(200000).parse(text);
        const kind = z.enum(['play', 'scene']).parse(req.body.kind);
        const scenes = parseScript(text, kind);
        if (
          !scenes.length ||
          scenes.length > 100 ||
          scenes.reduce((n, s) => n + s.lines.length, 0) > 3000
        )
          throw new AppError(400, 'Import up to 100 scenes and 3,000 lines at a time.');
        res.json({ scenes, originalFileId: fileId });
      } finally {
        if (req.file) await unlink(req.file.path).catch(() => {});
      }
    },
  );
  api.post('/groups/:groupId/scripts', editor, async (req, res) => {
    const body = z
      .object({
        title,
        author: z.string().max(160).default(''),
        kind: z.enum(['play', 'scene']),
        scenes: z.array(sceneSchema).min(1).max(100),
        originalFileId: id.nullable().optional(),
      })
      .parse(req.body);
    const total = body.scenes.reduce((n, s) => n + s.lines.length, 0),
      chars = body.scenes.flatMap((s) => s.lines).reduce((n, l) => n + l.text.length, 0);
    if (total > 3000 || chars > 200000)
      throw new AppError(400, 'This script is too large. Import individual scenes.');
    if (body.kind === 'scene' && body.scenes.length !== 1)
      throw new AppError(400, 'A standalone scene must contain one scene.');
    const scriptId = randomUUID();
    await transaction(async (c) => {
      await c.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE', [req.params.groupId]);
      const n = await c.query('SELECT count(*) FROM scripts WHERE group_id=$1', [
        req.params.groupId,
      ]);
      if (Number(n.rows[0].count) >= 50)
        throw new AppError(429, 'This group has reached its 50-script limit.');
      if (body.originalFileId) {
        const file = await c.query('SELECT id FROM files WHERE id=$1 AND group_id=$2', [
          body.originalFileId,
          req.params.groupId,
        ]);
        if (!file.rows.length) throw new AppError(400, 'The original file is unavailable.');
      }
      await c.query(
        'INSERT INTO scripts(id,group_id,title,author,kind,color,original_file_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          scriptId,
          req.params.groupId,
          body.title,
          body.author,
          body.kind,
          colorFor(body.title),
          body.originalFileId || null,
        ],
      );
      const characters = new Map<string, string>();
      for (const line of body.scenes.flatMap((s) => s.lines)) {
        if (line.speaker && !characters.has(line.speaker)) {
          const characterId = randomUUID();
          characters.set(line.speaker, characterId);
          if (characters.size > 100)
            throw new AppError(400, 'Use up to 100 characters per script.');
          await c.query('INSERT INTO characters(id,script_id,name) VALUES($1,$2,$3)', [
            characterId,
            scriptId,
            line.speaker,
          ]);
        }
      }
      for (const [position, scene] of body.scenes.entries()) {
        const sceneId = randomUUID();
        await c.query('INSERT INTO scenes(id,script_id,title,position) VALUES($1,$2,$3,$4)', [
          sceneId,
          scriptId,
          scene.title,
          position,
        ]);
        for (const [position, line] of scene.lines.entries())
          await c.query(
            'INSERT INTO lines(id,scene_id,character_id,text,position) VALUES($1,$2,$3,$4,$5)',
            [
              randomUUID(),
              sceneId,
              line.speaker ? characters.get(line.speaker) : null,
              line.text,
              position,
            ],
          );
      }
    });
    res.status(201).json({ id: scriptId });
  });
  api.get('/scripts/:id', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM scripts WHERE id=$1', [id.parse(req.params.id)]);
    if (!rows.length) throw new AppError(404, 'Script not found.');
    const role = await member(db, rows[0].group_id, req.identity.uid);
    const scenes = await db.query(
      'SELECT s.*,(SELECT count(*)::int FROM lines l WHERE l.scene_id=s.id) AS line_count,(SELECT count(*)::int FROM lines l WHERE l.scene_id=s.id AND l.character_id IS NOT NULL AND l.audio_id IS NULL) AS missing_audio FROM scenes s WHERE script_id=$1 ORDER BY position',
      [req.params.id],
    );
    const characters = await db.query('SELECT * FROM characters WHERE script_id=$1 ORDER BY name', [
      req.params.id,
    ]);
    res.json({ script: rows[0], role, scenes: scenes.rows, characters: characters.rows });
  });
  api.patch('/scripts/:id', async (req, res) => {
    const body = z
      .object({ title: title.optional(), color: z.number().int().min(0).max(4).optional() })
      .parse(req.body);
    const { rows } = await db.query('SELECT group_id FROM scripts WHERE id=$1', [
      id.parse(req.params.id),
    ]);
    if (!rows.length) throw new AppError(404, 'Script not found.');
    await member(db, rows[0].group_id, req.identity.uid, ['owner', 'editor']);
    await db.query(
      'UPDATE scripts SET title=coalesce($2,title),color=coalesce($3,color) WHERE id=$1',
      [req.params.id, body.title, body.color],
    );
    res.json({ ok: true });
  });
  api.delete('/scripts/:id', async (req, res) => {
    const { rows } = await db.query('SELECT group_id FROM scripts WHERE id=$1', [
      id.parse(req.params.id),
    ]);
    if (!rows.length) throw new AppError(404, 'Script not found.');
    await member(db, rows[0].group_id, req.identity.uid, ['owner', 'editor']);
    const assets = await db.query(
      'SELECT l.audio_id AS id FROM lines l JOIN scenes s ON s.id=l.scene_id WHERE s.script_id=$1 AND l.audio_id IS NOT NULL UNION SELECT original_file_id AS id FROM scripts WHERE id=$1 AND original_file_id IS NOT NULL',
      [req.params.id],
    );
    await db.query('DELETE FROM scripts WHERE id=$1', [req.params.id]);
    await removeUnusedIds(assets.rows.map((r) => r.id));
    res.json({ ok: true });
  });
  api.get('/scenes/:id', async (req, res) => {
    const scene = await sceneAccess(id.parse(req.params.id), req.identity.uid);
    const { rows: lines } = await db.query(
      'SELECT l.*,c.name AS speaker,c.voice_id,c.delivery FROM lines l LEFT JOIN characters c ON c.id=l.character_id WHERE scene_id=$1 ORDER BY position',
      [scene.id],
    );
    const { rows: jobs } = await db.query(
      "SELECT j.id,j.line_id,j.status,j.error FROM jobs j JOIN lines l ON l.id=j.line_id WHERE l.scene_id=$1 AND (j.status IN ('queued','running') OR j.created_at>now()-interval '1 day') ORDER BY j.created_at DESC",
      [scene.id],
    );
    res.json({ scene, lines, jobs });
  });
  api.patch('/lines/:id', async (req, res) => {
    const body = z
      .object({ text: z.string().min(1).max(12000), characterId: id.nullable() })
      .parse(req.body);
    const line = await lineAccess(id.parse(req.params.id), req.identity.uid, true);
    if (body.characterId) {
      const { rows } = await db.query('SELECT id FROM characters WHERE id=$1 AND script_id=$2', [
        body.characterId,
        line.script_id,
      ]);
      if (!rows.length) throw new AppError(400, 'Choose a character from this script.');
    }
    await transaction(async (c) => {
      await c.query(
        'UPDATE lines SET text=$2,character_id=$3,revision=revision+1,audio_id=NULL,audio_kind=NULL,updated_at=now() WHERE id=$1',
        [line.id, body.text, body.characterId],
      );
      await c.query('DELETE FROM practice WHERE line_id=$1', [line.id]);
    });
    if (line.audio_id) await removeUnusedIds([line.audio_id]);
    res.json({ ok: true });
  });
  api.post('/scenes/:id/lines', async (req, res) => {
    const scene = await sceneAccess(id.parse(req.params.id), req.identity.uid, true);
    const body = z
      .object({ speaker: name.nullable(), text: z.string().min(1).max(12000) })
      .parse(req.body);
    await transaction(async (c) => {
      await c.query('SELECT id FROM scenes WHERE id=$1 FOR UPDATE', [scene.id]);
      let characterId = null;
      if (body.speaker) {
        const found = await c.query('SELECT id FROM characters WHERE script_id=$1 AND name=$2', [
          scene.script_id,
          body.speaker,
        ]);
        characterId = found.rows[0]?.id || randomUUID();
        if (!found.rows.length)
          await c.query('INSERT INTO characters(id,script_id,name) VALUES($1,$2,$3)', [
            characterId,
            scene.script_id,
            body.speaker,
          ]);
      }
      const n = await c.query(
        'SELECT coalesce(max(position),-1)+1 AS position FROM lines WHERE scene_id=$1',
        [scene.id],
      );
      if (n.rows[0].position >= 1000)
        throw new AppError(400, 'This scene has reached its line limit.');
      await c.query(
        'INSERT INTO lines(id,scene_id,character_id,text,position) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), scene.id, characterId, body.text, n.rows[0].position],
      );
    });
    res.status(201).json({ ok: true });
  });
  api.delete('/lines/:id', async (req, res) => {
    const line = await lineAccess(id.parse(req.params.id), req.identity.uid, true);
    await db.query('DELETE FROM lines WHERE id=$1', [line.id]);
    if (line.audio_id) await removeUnusedIds([line.audio_id]);
    res.json({ ok: true });
  });
  api.patch('/characters/:id', async (req, res) => {
    const body = z
      .object({ voiceId: z.string().min(1).max(80), delivery: z.enum(['neutral', 'expressive']) })
      .parse(req.body);
    const { rows } = await db.query(
      'SELECT c.*,p.group_id FROM characters c JOIN scripts p ON p.id=c.script_id WHERE c.id=$1',
      [id.parse(req.params.id)],
    );
    if (!rows.length) throw new AppError(404, 'Character not found.');
    await member(db, rows[0].group_id, req.identity.uid, ['owner', 'editor']);
    if (!(await voices()).some((v) => v.id === body.voiceId))
      throw new AppError(400, 'Choose an available voice.');
    await db.query('UPDATE characters SET voice_id=$2,delivery=$3 WHERE id=$1', [
      req.params.id,
      body.voiceId,
      body.delivery,
    ]);
    res.json({ ok: true });
  });
  api.get('/voices', async (_req, res) => res.json({ voices: await voices() }));
  api.post('/scenes/:id/generate', async (req, res) => {
    const body = z
      .object({
        lineIds: z.array(id).min(1).max(100).optional(),
        regenerate: z.boolean().default(false),
      })
      .parse(req.body);
    res.json(
      await enqueueGeneration(
        req.identity.uid,
        id.parse(req.params.id),
        body.lineIds,
        body.regenerate,
      ),
    );
  });
  api.post(
    '/lines/:id/recording',
    uploadLimiter,
    async (req, res, next) => {
      try {
        await lineAccess(id.parse(req.params.id), req.identity.uid, true);
        next();
      } catch (e) {
        next(e);
      }
    },
    upload.single('file'),
    async (req, res) => {
      if (!req.file) throw new AppError(400, 'Choose a recording.');
      try {
        const line = await lineAccess(id.parse(req.params.id), req.identity.uid, true);
        const revision = z.coerce.number().int().parse(req.body.revision);
        if (revision !== line.revision)
          throw new AppError(409, 'The line changed while you recorded. Record its updated words.');
        const buffer = await convertRecording(req.file.path);
        const fileId = await saveFile(line.group_id, buffer, 'audio/mpeg', 'Recorded line.mp3');
        const result = await db.query(
          "UPDATE lines SET audio_id=$2,audio_kind='recorded',updated_at=now() WHERE id=$1 AND revision=$3",
          [line.id, fileId, revision],
        );
        if (!result.rowCount)
          throw new AppError(409, 'The line changed while saving your recording.');
        if (line.audio_id) await removeUnusedIds([line.audio_id]);
        res.json({ audioId: fileId });
      } finally {
        await unlink(req.file.path).catch(() => {});
      }
    },
  );
  api.get('/files/:id', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM files WHERE id=$1', [id.parse(req.params.id)]);
    if (!rows.length) throw new AppError(404, 'File not found.');
    const file = rows[0];
    await member(db, file.group_id, req.identity.uid);
    res.set('Content-Type', file.mime);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', file.mime.startsWith('audio/') ? 'inline' : 'attachment');
    res.sendFile(resolve(config.dataDir, file.storage_name), { dotfiles: 'allow' });
  });
  api.get('/groups/:groupId/practice', async (req, res) => {
    await member(db, id.parse(req.params.groupId), req.identity.uid);
    const { rows } = await db.query(
      `SELECT pr.*,l.text,l.scene_id,l.position,c.name AS speaker,s.title AS scene_title,s.script_id,p.title AS script_title FROM practice pr JOIN lines l ON l.id=pr.line_id LEFT JOIN characters c ON c.id=l.character_id JOIN scenes s ON s.id=l.scene_id JOIN scripts p ON p.id=s.script_id WHERE pr.uid=$1 AND p.group_id=$2 AND (pr.score>=2 OR pr.saved) ORDER BY pr.score DESC,pr.updated_at DESC`,
      [req.identity.uid, req.params.groupId],
    );
    res.json({ lines: rows });
  });
  api.post('/practice', async (req, res) => {
    const body = z
      .object({
        eventId: id,
        lineId: id,
        kind: z.enum(['repeat', 'hint', 'remembered', 'save', 'unsave']),
      })
      .parse(req.body);
    await lineAccess(body.lineId, req.identity.uid);
    await transaction(async (c) => {
      const event = await c.query(
        'INSERT INTO practice_events(id,uid) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
        [body.eventId, req.identity.uid],
      );
      if (!event.rowCount) return;
      await c.query('INSERT INTO practice(uid,line_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        req.identity.uid,
        body.lineId,
      ]);
      const delta =
        body.kind === 'hint' ? 3 : body.kind === 'repeat' ? 2 : body.kind === 'remembered' ? -2 : 0;
      await c.query(
        `UPDATE practice SET score=greatest(0,score+$3),repeats=repeats+$4,hints=hints+$5,remembered=remembered+$6,saved=coalesce($7,saved),updated_at=now() WHERE uid=$1 AND line_id=$2`,
        [
          req.identity.uid,
          body.lineId,
          delta,
          body.kind === 'repeat' ? 1 : 0,
          body.kind === 'hint' ? 1 : 0,
          body.kind === 'remembered' ? 1 : 0,
          body.kind === 'save' ? true : body.kind === 'unsave' ? false : null,
        ],
      );
    });
    res.json({ ok: true });
  });
  api.use((_req, res) => res.status(404).json({ error: 'This action is not available.' }));
  app.get(config.base, (_req, res) => res.redirect(308, config.base + '/'));
  app.use(
    config.base,
    express.static(resolve('dist'), {
      index: 'index.html',
      setHeaders: (res, path) => {
        if (path.endsWith('sw.js') || path.endsWith('index.html'))
          res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  const error: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ZodError || err.code === '22P02') {
      res.status(400).json({ error: 'Check the entered text and selections.' });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(413).json({ error: 'Choose one file of up to 10 MB.' });
      return;
    }
    console.error('Request failed:', err.code || err.name || 'error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
  app.use(error);
  return app;
}
