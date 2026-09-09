import { db, transaction } from './db.js';
import { config } from './config.js';
import { member, saveFile, removeUnusedFiles, removeUnusedIds } from './storage.js';
import { finishGeneration } from './generation.js';
const lease = await db.connect();
const locked = await lease.query('SELECT pg_try_advisory_lock(103) AS acquired');
if (!locked.rows[0].acquired) {
  console.error('Another audio worker already holds the processing lease.');
  lease.release();
  await db.end();
  process.exit(1);
}
let stop = false;
process.on('SIGTERM', () => (stop = true));
process.on('SIGINT', () => (stop = true));
// A worker crash is an uncertain provider outcome: keep the charge reservation; never auto-rebill.
await db.query(
  "UPDATE jobs SET status='failed',error='Processing was interrupted. Review the allowance before retrying.',finished_at=now() WHERE status='running'",
);
let cleanupAt = 0;
while (!stop) {
  try {
    const job = await transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!rows.length) return null;
      await c.query("UPDATE jobs SET status='running',started_at=now() WHERE id=$1", [rows[0].id]);
      return rows[0];
    });
    if (!job) {
      if (Date.now() - cleanupAt > 3600000) {
        await removeUnusedFiles();
        cleanupAt = Date.now();
      }
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    try {
      await member(db, job.group_id, job.requested_by, ['owner', 'editor']);
      const before = await db.query('SELECT revision,audio_kind FROM lines WHERE id=$1', [
        job.line_id,
      ]);
      if (
        !before.rows.length ||
        before.rows[0].revision !== job.payload.revision ||
        before.rows[0].audio_kind === 'recorded'
      )
        throw new Error('This line changed before preparation.');
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(job.payload.voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': config.elevenKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: job.payload.text,
            model_id: config.model,
            voice_settings: {
              stability: job.payload.delivery === 'expressive' ? 0.35 : 0.8,
              similarity_boost: 0.75,
              style: job.payload.delivery === 'expressive' ? 0.4 : 0,
              use_speaker_boost: true,
            },
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'The voice provider is busy or out of credits. Try again later.'
            : 'The voice provider could not prepare this line.',
        );
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('The generated audio exceeded the size limit.');
        }
        chunks.push(value);
      }
      const fileId = await saveFile(
        job.group_id,
        Buffer.concat(chunks),
        'audio/mpeg',
        'AI line.mp3',
      );
      const old = await db.query('SELECT audio_id FROM lines WHERE id=$1', [job.line_id]);
      const applied = await finishGeneration(job, fileId);
      await removeUnusedIds(applied ? old.rows.map((r) => r.audio_id).filter(Boolean) : [fileId]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Audio preparation failed.';
      await db.query("UPDATE jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1", [
        job.id,
        message.includes('timeout')
          ? 'Audio preparation timed out. Its allowance remains reserved.'
          : message.slice(0, 180),
      ]);
    }
  } catch {
    console.error('Worker could not process its queue.');
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await lease.query('SELECT pg_advisory_unlock(103)');
lease.release();
await db.end();
