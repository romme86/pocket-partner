export type ParsedLine = { speaker: string | null; text: string };
export type ParsedScene = { title: string; lines: ParsedLine[] };
// Deterministic extraction keeps authors' words intact. Review is mandatory before import.
export function parseScript(input: string, kind: 'play' | 'scene'): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  let scene: ParsedScene = { title: kind === 'scene' ? 'Scene' : 'Scene 1', lines: [] };
  let speaker: string | null = null;
  let act = '';
  const flushScene = () => {
    if (scene.lines.length) scenes.push(scene);
  };
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const text = raw.trim();
    if (!text) continue;
    if (kind === 'play' && /^(ACT|ACTE|ATTO)\s+[\dIVXLC]+\b/i.test(text)) {
      act = text;
      continue;
    }
    if (kind === 'play' && /^(SCENE|SCÈNE|SCENA)\s+[\dIVXLC]+\b/i.test(text)) {
      flushScene();
      scene = { title: act ? `${act} · ${text}` : text, lines: [] };
      speaker = null;
      continue;
    }
    if (/^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) {
      scene.lines.push({ speaker: null, text });
      speaker = null;
      continue;
    }
    const colon = text.match(/^([\p{L}][\p{L}\p{N} .’'\-]{0,59}):\s*(.*)$/u);
    const label =
      !colon &&
      text.length <= 60 &&
      /^[\p{Lu}][\p{Lu}\p{N} .’'\-]+\.?$/u.test(text) &&
      !/[!?]/.test(text);
    if (colon) {
      speaker = colon[1].trim();
      if (colon[2]) scene.lines.push({ speaker, text: colon[2] });
      continue;
    }
    if (label) {
      speaker = text.replace(/\.$/, '').trim();
      continue;
    }
    const prev = scene.lines.at(-1);
    if (speaker && prev?.speaker === speaker) prev.text += '\n' + text;
    else scene.lines.push({ speaker, text });
  }
  flushScene();
  return scenes;
}
export const palette = [
  { name: 'Curtain red', bg: '#8b3a49', ink: '#f1d5a1' },
  { name: 'Forest', bg: '#354b44', ink: '#eddfa9' },
  { name: 'Theater gold', bg: '#d9c399', ink: '#533d34' },
  { name: 'Midnight', bg: '#303f56', ink: '#e5ddcb' },
  { name: 'Plum', bg: '#4b414f', ink: '#ead3a7' },
];
export function colorFor(title: string) {
  let h = 0;
  for (const c of title.toLowerCase()) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return h % palette.length;
}
