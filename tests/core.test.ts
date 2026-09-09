import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { parseScript } from '../server/parser.js';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://pocket:pocket-local-only@127.0.0.1:55432/pocket_test';
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Tests require a database whose name ends in _test.');
process.env.NODE_ENV = 'test';
process.env.AI_MONTHLY_CHARACTERS = '100';
process.env.AI_GROUP_MONTHLY_CHARACTERS = '60';
process.env.ELEVENLABS_API_KEY = 'test-key-never-sent';
process.env.DATA_DIR = '.private/test-data';
const { db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { saveFile } = await import('../server/storage.js');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  assert.equal(
    url,
    'https://api.elevenlabs.io/v1/voices',
    'Tests must never call a billable service',
  );
  return new Response(
    JSON.stringify({ voices: [{ voice_id: 'test-voice', name: 'Test voice' }] }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
const app = createApp(async (req, res, next) => {
  const uid = req.header('x-test-uid');
  if (!uid) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }
  req.identity = { uid, email: uid + '@example.invalid', name: uid, authTime: Date.now() / 1000 };
  next();
});
const as = (uid: string) => ({
  get: (url: string) =>
    request(app)
      .get('/pocket-partner/api' + url)
      .set('x-test-uid', uid),
  post: (url: string) =>
    request(app)
      .post('/pocket-partner/api' + url)
      .set('x-test-uid', uid),
  patch: (url: string) =>
    request(app)
      .patch('/pocket-partner/api' + url)
      .set('x-test-uid', uid),
  delete: (url: string) =>
    request(app)
      .delete('/pocket-partner/api' + url)
      .set('x-test-uid', uid),
});
const suffix = randomUUID();
const a = 'owner-' + suffix,
  b = 'outsider-' + suffix,
  c = 'member-' + suffix;
let groupId: string,
  scriptId: string,
  sceneId: string,
  lineIds: string[] = [];
before(async () => {
  await db.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const uid of [a, b, c])
    await db.query('INSERT INTO app_users(uid,email,name) VALUES($1,$2,$1)', [
      uid,
      uid + '@example.invalid',
    ]);
});
after(async () => {
  globalThis.fetch = originalFetch;
  await db.query('DELETE FROM groups WHERE owner_uid=ANY($1::text[])', [[a, b, c]]);
  await db.query('DELETE FROM app_users WHERE uid=ANY($1::text[])', [[a, b, c]]);
  await db.query('DELETE FROM budgets WHERE period=$1', [new Date().toISOString().slice(0, 7)]);
  await db.end();
});
test('Script parser preserves dialogue, stage directions and scene boundaries', () => {
  const scenes = parseScript(
    'ACT I\nSCENE I\n[The room is empty.]\nHERMIA: One line.\nA continuation.\nHELENA\nAnother line.\nSCENE II\nHERMIA: The next scene.',
    'play',
  );
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0].lines, [
    { speaker: null, text: '[The room is empty.]' },
    { speaker: 'HERMIA', text: 'One line.\nA continuation.' },
    { speaker: 'HELENA', text: 'Another line.' },
  ]);
  assert.equal(parseScript('HERMIA: One line.', 'scene').length, 1);
});
test('Create and import into a private group; outsiders cannot read or change it', async () => {
  const result = await as(a).post('/groups').send({ name: 'Private test cast' }).expect(201);
  groupId = result.body.id;
  await as(b)
    .get('/groups/' + groupId)
    .expect(404);
  await as(b)
    .post('/groups/' + groupId + '/scripts')
    .send({})
    .expect(404);
  const uploaded = await as(a)
    .post('/groups/' + groupId + '/scripts')
    .send({
      title: 'Test scene',
      kind: 'scene',
      scenes: [
        {
          title: 'The room',
          lines: [
            { speaker: 'ALICE', text: 'A'.repeat(25) },
            { speaker: 'BOB', text: 'B'.repeat(25) },
            { speaker: 'ALICE', text: 'C'.repeat(25) },
          ],
        },
      ],
    })
    .expect(201);
  scriptId = uploaded.body.id;
  const detail = await as(a)
    .get('/scripts/' + scriptId)
    .expect(200);
  sceneId = detail.body.scenes[0].id;
  const scene = await as(a)
    .get('/scenes/' + sceneId)
    .expect(200);
  lineIds = scene.body.lines.map((l: any) => l.id);
  await as(b)
    .get('/scripts/' + scriptId)
    .expect(404);
  await as(b)
    .get('/scenes/' + sceneId)
    .expect(404);
  await as(b)
    .patch('/lines/' + lineIds[0])
    .send({ text: 'changed', characterId: null })
    .expect(404);
  await request(app)
    .get('/pocket-partner/api/groups/' + groupId)
    .expect(401);
});
test('One-use invitations cannot be redeemed twice; members cannot edit or invite', async () => {
  const invite = await as(a)
    .post('/groups/' + groupId + '/invitations')
    .send({ role: 'member' })
    .expect(200);
  const token = invite.body.url.split('/').at(-1);
  const results = await Promise.all([
    as(c)
      .post('/invitations/' + token + '/accept')
      .send({}),
    as(b)
      .post('/invitations/' + token + '/accept')
      .send({}),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
  const winner = results[0].status === 200 ? c : b;
  await as(winner)
    .get('/scenes/' + sceneId)
    .expect(200);
  await as(winner)
    .patch('/lines/' + lineIds[0])
    .send({ text: 'changed', characterId: null })
    .expect(403);
  await as(winner)
    .post('/groups/' + groupId + '/invitations')
    .send({ role: 'editor' })
    .expect(403);
  await as(a)
    .delete('/groups/' + groupId + '/members/' + winner)
    .expect(200);
  await as(winner)
    .get('/scenes/' + sceneId)
    .expect(404);
});
test('Files require current group membership, including after a member is removed', async () => {
  const fileId = await saveFile(
    groupId,
    Buffer.from('private test recording'),
    'audio/mpeg',
    'recording.mp3',
  );
  await as(a)
    .get('/files/' + fileId)
    .expect(200)
    .expect('Cache-Control', 'private, no-store');
  await as(b)
    .get('/files/' + fileId)
    .expect(404);
  await as(c)
    .get('/files/' + fileId)
    .expect(404);
  await request(app)
    .get('/pocket-partner/api/files/' + fileId)
    .expect(401);
});
test('Practice events are private, idempotent and never lower scores below zero', async () => {
  const event = { eventId: randomUUID(), lineId: lineIds[0], kind: 'hint' };
  await as(a).post('/practice').send(event).expect(200);
  await as(a).post('/practice').send(event).expect(200);
  let rows = await as(a)
    .get('/groups/' + groupId + '/practice')
    .expect(200);
  assert.equal(rows.body.lines[0].score, 3);
  await as(b)
    .post('/practice')
    .send({ ...event, eventId: randomUUID() })
    .expect(404);
  for (let i = 0; i < 3; i++)
    await as(a)
      .post('/practice')
      .send({ ...event, eventId: randomUUID(), kind: 'remembered' })
      .expect(200);
  rows = await as(a)
    .get('/groups/' + groupId + '/practice')
    .expect(200);
  assert.equal(rows.body.lines.length, 0);
});
test('Parallel generation requests reserve allowance once and preserve recordings', async () => {
  await db.query('UPDATE characters SET voice_id=$1 WHERE script_id=$2', ['test-voice', scriptId]);
  const fileId = await saveFile(groupId, Buffer.from('human recording'), 'audio/mpeg', 'human.mp3');
  await db.query("UPDATE lines SET audio_id=$1,audio_kind='recorded' WHERE id=$2", [
    fileId,
    lineIds[0],
  ]);
  const requests = await Promise.all([
    as(a)
      .post('/scenes/' + sceneId + '/generate')
      .send({}),
    as(a)
      .post('/scenes/' + sceneId + '/generate')
      .send({}),
  ]);
  assert.ok(requests.every((r) => r.status === 200));
  assert.equal(
    requests.reduce((n, r) => n + r.body.queued, 0),
    2,
  );
  const budget = await db.query('SELECT characters FROM budgets WHERE scope=$1 AND period=$2', [
    'group:' + groupId,
    new Date().toISOString().slice(0, 7),
  ]);
  assert.equal(Number(budget.rows[0].characters), 50);
  assert.equal((await db.query('SELECT * FROM jobs WHERE line_id=$1', [lineIds[0]])).rowCount, 0);
  await db.query("UPDATE jobs SET status='failed' WHERE group_id=$1", [groupId]);
  await as(a)
    .post('/scenes/' + sceneId + '/generate')
    .send({ lineIds: [lineIds[1]], regenerate: true })
    .expect(429);
  assert.equal(
    (await db.query('SELECT audio_kind FROM lines WHERE id=$1', [lineIds[0]])).rows[0].audio_kind,
    'recorded',
  );
});
test('Identifiers from another group cannot attach a private source file', async () => {
  const g = await as(b).post('/groups').send({ name: 'Other cast' }).expect(201);
  const fileId = await saveFile(
    g.body.id,
    Buffer.from('other private text'),
    'text/plain',
    'private.txt',
  );
  await as(a)
    .post('/groups/' + groupId + '/scripts')
    .send({
      title: 'Wrong source',
      kind: 'scene',
      originalFileId: fileId,
      scenes: [{ title: 'Scene', lines: [{ speaker: 'A', text: 'Hello' }] }],
    })
    .expect(400);
});

test('An AI result arriving after a human take cannot overwrite that take', async () => {
  const { finishGeneration } = await import('../server/generation.js');
  const lineId = lineIds[1];
  const line = (await db.query('SELECT * FROM lines WHERE id=$1', [lineId])).rows[0];
  const job = (
    await db.query('SELECT * FROM jobs WHERE line_id=$1 ORDER BY created_at DESC LIMIT 1', [lineId])
  ).rows[0];
  const human = await saveFile(groupId, Buffer.from('new human take'), 'audio/mpeg', 'new.mp3');
  const generated = await saveFile(groupId, Buffer.from('late AI result'), 'audio/mpeg', 'ai.mp3');
  await db.query("UPDATE lines SET audio_id=$1,audio_kind='recorded' WHERE id=$2", [human, lineId]);
  assert.equal(await finishGeneration(job, generated), false);
  const result = (await db.query('SELECT audio_id,audio_kind FROM lines WHERE id=$1', [lineId]))
    .rows[0];
  assert.equal(result.audio_id, human);
  assert.equal(result.audio_kind, 'recorded');
});
