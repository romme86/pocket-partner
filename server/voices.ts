import { config } from './config.js';
import { AppError } from './storage.js';
export type Voice = { id: string; name: string; description: string };
let cached: Voice[] = [];
let cachedAt = 0;
export async function voices() {
  if (Date.now() - cachedAt < 3600000 && cached.length) return cached;
  if (!config.elevenKey) return [];
  const r = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': config.elevenKey },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok)
    throw new AppError(503, 'Voice profiles are temporarily unavailable. Recording still works.');
  const data = (await r.json()) as {
    voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
  };
  cached = data.voices
    .slice(0, 60)
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      description: [v.labels?.gender, v.labels?.accent, v.labels?.description]
        .filter(Boolean)
        .join(' · '),
    }));
  cachedAt = Date.now();
  return cached;
}
