import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db, transaction } from './db.js';
import { AppError, member } from './storage.js';
import { voices } from './voices.js';
export async function enqueueGeneration(
  uid: string,
  sceneId: string,
  lineIds?: string[],
  regenerate = false,
) {
  if (!config.elevenKey)
    throw new AppError(503, 'AI voices are not configured. You can record lines instead.');
  const available = new Set((await voices()).map((v) => v.id));
  return transaction(async (c) => {
    // One transactional reservation protects the global and group limits under concurrent requests.
    await c.query('SELECT pg_advisory_xact_lock(101)');
    const { rows: scope } = await c.query(
      'SELECT p.group_id FROM scenes s JOIN scripts p ON p.id=s.script_id WHERE s.id=$1',
      [sceneId],
    );
    if (!scope.length) throw new AppError(404, 'Scene not found.');
    const groupId = scope[0].group_id;
    await member(c, groupId, uid, ['owner', 'editor']);
    const { rows } = await c.query(
      `SELECT l.*,c.voice_id,c.delivery FROM lines l JOIN characters c ON c.id=l.character_id WHERE l.scene_id=$1 AND l.audio_kind IS DISTINCT FROM 'recorded' AND ($2::uuid[] IS NULL OR l.id=ANY($2::uuid[])) AND ($3::boolean OR l.audio_id IS NULL) AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.line_id=l.id AND j.status IN ('queued','running')) ORDER BY l.position`,
      [sceneId, lineIds || null, regenerate],
    );
    if (!rows.length) return { queued: 0, characters: 0 };
    if (rows.length > 100)
      throw new AppError(
        400,
        'Prepare up to 100 lines at a time. Select a character or smaller scene.',
      );
    for (const line of rows) {
      if (!available.has(line.voice_id))
        throw new AppError(400, 'Choose a voice for each character first.');
      if (line.text.length > 2000)
        throw new AppError(
          400,
          'Split speeches longer than 2,000 characters before generating audio.',
        );
    }
    const cost = rows.reduce((n, l) => n + l.text.length, 0);
    const period = new Date().toISOString().slice(0, 7);
    for (const [scope, limit] of [
      ['global', config.globalChars],
      ['group:' + groupId, config.groupChars],
    ] as const) {
      await c.query('INSERT INTO budgets(scope,period) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        scope,
        period,
      ]);
      const { rows: budget } = await c.query(
        'SELECT characters FROM budgets WHERE scope=$1 AND period=$2 FOR UPDATE',
        [scope, period],
      );
      if (Number(budget[0].characters) + cost > limit)
        throw new AppError(
          429,
          `This request exceeds the remaining ${scope === 'global' ? 'app' : 'group'} AI allowance for this month.`,
        );
      await c.query('UPDATE budgets SET characters=characters+$3 WHERE scope=$1 AND period=$2', [
        scope,
        period,
        cost,
      ]);
    }
    for (const line of rows)
      await c.query(
        'INSERT INTO jobs(id,group_id,line_id,requested_by,payload) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          groupId,
          line.id,
          uid,
          JSON.stringify({
            text: line.text,
            revision: line.revision,
            voiceId: line.voice_id,
            delivery: line.delivery,
          }),
        ],
      );
    return { queued: rows.length, characters: cost };
  });
}
export async function budgetFor(groupId: string) {
  const { rows } = await db.query(
    'SELECT scope,characters FROM budgets WHERE period=$1 AND scope=ANY($2::text[])',
    [new Date().toISOString().slice(0, 7), ['global', 'group:' + groupId]],
  );
  return {
    groupRemaining: Math.max(
      0,
      config.groupChars - Number(rows.find((r) => r.scope === 'group:' + groupId)?.characters || 0),
    ),
    globalRemaining: Math.max(
      0,
      config.globalChars - Number(rows.find((r) => r.scope === 'global')?.characters || 0),
    ),
    enabled: !!config.elevenKey,
  };
}
export async function finishGeneration(
  job: {
    id: string;
    line_id: string;
    payload: { revision: number; voiceId: string; delivery: string };
  },
  fileId: string,
) {
  return transaction(async (c) => {
    const result = await c.query(
      "UPDATE lines l SET audio_id=$1,audio_kind='ai',updated_at=now() FROM characters c WHERE l.id=$2 AND l.revision=$3 AND l.audio_kind IS DISTINCT FROM 'recorded' AND c.id=l.character_id AND c.voice_id=$4 AND c.delivery=$5",
      [fileId, job.line_id, job.payload.revision, job.payload.voiceId, job.payload.delivery],
    );
    await c.query('UPDATE jobs SET status=$2,error=$3,finished_at=now() WHERE id=$1', [
      job.id,
      result.rowCount ? 'done' : 'cancelled',
      result.rowCount ? null : 'The line changed during generation. Its current audio was kept.',
    ]);
    return !!result.rowCount;
  });
}
