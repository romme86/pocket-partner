import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db, transaction, type SQL } from './db.js';
export const runFile = promisify(execFile);
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function member(c: SQL, groupId: string, uid: string, roles?: string[]) {
  const { rows } = await c.query('SELECT role FROM memberships WHERE group_id=$1 AND uid=$2', [
    groupId,
    uid,
  ]);
  if (!rows.length) throw new AppError(404, 'This group is not available.');
  if (roles && !roles.includes(rows[0].role))
    throw new AppError(403, 'An editor or owner needs to make this change.');
  return rows[0].role as string;
}
export async function lineAccess(id: string, uid: string, edit = false) {
  const { rows } = await db.query(
    `SELECT l.*,s.script_id,p.group_id,c.name AS speaker,c.voice_id,c.delivery FROM lines l JOIN scenes s ON s.id=l.scene_id JOIN scripts p ON p.id=s.script_id LEFT JOIN characters c ON c.id=l.character_id WHERE l.id=$1`,
    [id],
  );
  if (!rows.length) throw new AppError(404, 'Line not found.');
  await member(db, rows[0].group_id, uid, edit ? ['owner', 'editor'] : undefined);
  return rows[0];
}
export async function sceneAccess(id: string, uid: string, edit = false) {
  const { rows } = await db.query(
    'SELECT s.*,p.group_id,p.title AS script_title FROM scenes s JOIN scripts p ON p.id=s.script_id WHERE s.id=$1',
    [id],
  );
  if (!rows.length) throw new AppError(404, 'Scene not found.');
  await member(db, rows[0].group_id, uid, edit ? ['owner', 'editor'] : undefined);
  return rows[0];
}
export async function saveFile(groupId: string, buffer: Buffer, mime: string, name: string) {
  const id = randomUUID(),
    storageName = id;
  const path = resolve(config.dataDir, storageName);
  await writeFile(path, buffer, { mode: 0o600 });
  try {
    await transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(102)');
      const { rows } = await c.query(
        'SELECT coalesce(sum(bytes),0)::bigint AS total,coalesce(sum(bytes) FILTER(WHERE group_id=$1),0)::bigint AS local FROM files',
        [groupId],
      );
      if (
        Number(rows[0].local) + buffer.length > config.groupStorage ||
        Number(rows[0].total) + buffer.length > config.globalStorage
      )
        throw new AppError(
          413,
          'Storage allowance reached. Remove a script or recording before adding more.',
        );
      await c.query(
        'INSERT INTO files(id,group_id,storage_name,mime,bytes,name) VALUES($1,$2,$3,$4,$5,$6)',
        [id, groupId, storageName, mime, buffer.length, name.slice(0, 200)],
      );
    });
    return id;
  } catch (e) {
    await unlink(path).catch(() => {});
    throw e;
  }
}
export async function removeUnusedIds(ids: string[]) {
  if (!ids.length) return;
  const { rows } = await db.query(
    `DELETE FROM files f WHERE f.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM lines WHERE audio_id=f.id) AND NOT EXISTS(SELECT 1 FROM scripts WHERE original_file_id=f.id) RETURNING storage_name`,
    [ids],
  );
  for (const row of rows) await unlink(resolve(config.dataDir, row.storage_name)).catch(() => {});
}
export async function removeUnusedFiles() {
  const { rows } = await db.query(
    `DELETE FROM files f WHERE f.created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM lines WHERE audio_id=f.id) AND NOT EXISTS(SELECT 1 FROM scripts WHERE original_file_id=f.id) RETURNING storage_name`,
  );
  for (const row of rows) await unlink(resolve(config.dataDir, row.storage_name)).catch(() => {});
  for (const name of await readdir(resolve(config.dataDir, 'tmp'))) {
    const path = resolve(config.dataDir, 'tmp', name);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 3600000) await unlink(path).catch(() => {});
  }
}
export async function convertRecording(input: string) {
  const output = resolve(config.dataDir, 'tmp', randomUUID() + '.mp3');
  try {
    const probe = await runFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input],
      { timeout: 10000, maxBuffer: 65536 },
    );
    const seconds = Number(JSON.parse(probe.stdout).format?.duration);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > config.maxRecordingSeconds)
      throw new AppError(400, 'Record a line of up to 3 minutes.');
    await runFile(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-i',
        input,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '96k',
        '-t',
        '180',
        '-threads',
        '1',
        output,
      ],
      { timeout: 45000, maxBuffer: 65536 },
    );
    if ((await stat(output)).size > config.maxUpload)
      throw new AppError(413, 'The recording is too large.');
    return await readFile(output);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, 'This audio could not be read. Please record again.');
  } finally {
    await unlink(output).catch(() => {});
  }
}
