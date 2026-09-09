import { useState, useEffect, type FormEvent } from 'react';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
} from 'firebase/auth';
import type { Context } from './App';
import { Icon } from './icons';
import { colors, type Script, type Line, type Practice } from './types';
import { api, send, audioBlob, downloadOriginal } from './api';
import * as offline from './offline';
export const Pill = ({ children, kind = '' }: { children: React.ReactNode; kind?: string }) => (
  <span className={'pill ' + kind}>{children}</span>
);
export function Roles({ ctx, interactive = true }: { ctx: Context; interactive?: boolean }) {
  const present = new Set(ctx.scene?.lines.map((l) => l.character_id));
  return (
    <div className="role-list">
      {ctx.script?.characters
        .filter((c) => present.has(c.id))
        .map((c) => (
          <div className="role-row" key={c.id}>
            <span className="role-initial">{c.name[0]}</span>
            <span>
              <b>{c.name}</b>
              <small>{ctx.live.has(c.id) ? 'Performed in the room' : 'Played by the app'}</small>
            </span>
            {interactive ? (
              <div className="segmented" aria-label={'Who performs ' + c.name}>
                {['Live', 'App'].map((value) => (
                  <button
                    key={value}
                    className={ctx.live.has(c.id) === (value === 'Live') ? 'selected' : ''}
                    aria-pressed={ctx.live.has(c.id) === (value === 'Live')}
                    onClick={() => {
                      const live = new Set(ctx.live);
                      if (value === 'Live') live.add(c.id);
                      else live.delete(c.id);
                      ctx.setLive(live);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : (
              <Pill kind={ctx.live.has(c.id) ? 'wine' : 'gold'}>
                {ctx.live.has(c.id) ? 'Live' : 'App'}
              </Pill>
            )}
          </div>
        ))}
    </div>
  );
}
export function MyRole({ ctx }: { ctx: Context }) {
  const present = new Set(ctx.scene?.lines.map((l) => l.character_id));
  return (
    <label className="field my-role">
      My part
      <select
        className="input"
        value={ctx.myRole}
        onChange={(e) => {
          ctx.setMyRole(e.target.value);
          if (e.target.value) {
            const live = new Set(ctx.live);
            live.add(e.target.value);
            ctx.setLive(live);
          }
        }}
      >
        <option value="">I’m directing / listening</option>
        {ctx.script?.characters
          .filter((c) => present.has(c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
      <small className="input-hint">
        Only hints and repeats for your part go into My practice.
      </small>
    </label>
  );
}
export function Library({ ctx }: { ctx: Context }) {
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState('');
  const scripts = ctx.data!.scripts.filter(
    (s) =>
      (filter === 'all' || s.kind === filter) &&
      s.title.toLowerCase().includes(query.toLowerCase()),
  );
  function card(s: Script) {
    const color = colors[s.color];
    return (
      <article className="script-card" key={s.id}>
        <button
          className="book-cover"
          style={{ '--cover': color.bg, '--cover-ink': color.ink } as React.CSSProperties}
          onClick={() => ctx.chooseScript(s.id)}
          aria-label={'Open ' + s.title}
        >
          <span className="cover-top">
            {s.kind === 'play' ? 'THE PLAY COLLECTION' : 'SCENE COLLECTION'}
            <Icon name={s.kind === 'play' ? 'library' : 'file'} />
          </span>
          <span className="cover-title">{s.title}</span>
          <span className="cover-rule" />
          <span className="cover-bottom">
            <span>{s.author || ctx.group!.name}</span>
            <span>POCKET PARTNER</span>
          </span>
        </button>
        <div className="card-body">
          <div className="card-title">
            <button className="card-title-link" onClick={() => ctx.chooseScript(s.id)}>
              {s.title}
            </button>
            {ctx.canEdit && (
              <button
                className="icon-btn"
                aria-label={'Cover color for ' + s.title}
                onClick={() => ctx.open('color', s)}
              >
                <Icon name="more" />
              </button>
            )}
          </div>
          <p className="card-meta">
            {s.kind === 'scene' ? 'Standalone scene' : `${s.scene_count} scenes`} ·{' '}
            {s.character_count} characters
          </p>
          <div className="card-audio">
            <button className="text-link" onClick={() => ctx.chooseScript(s.id, 'audio')}>
              <Icon name="mic" />
              Record & AI
              <Icon name="arrow" />
            </button>
          </div>
        </div>
      </article>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your library</h1>
          <p>A space for every part you play.</p>
        </div>
        {ctx.canEdit && (
          <button className="btn" onClick={() => ctx.open('import')} disabled={!ctx.online}>
            <Icon name="plus" />
            Add a script
          </button>
        )}
      </div>
      {ctx.script && ctx.scene && (
        <section className="continue-card">
          <div className="continue-main">
            <div className="eyebrow">
              <Icon name="play" />
              YOUR CURRENT SCENE
            </div>
            <h2 className="serif">{ctx.script.script.title}</h2>
            <p>{ctx.scene.scene.title}</p>
            <div className="continue-footer">
              <button className="btn gold" onClick={() => ctx.go('rehearse')}>
                <Icon name="play" />
                Continue scene
              </button>
              <button className="continue-audio" onClick={() => ctx.go('audio')}>
                <Icon name="mic" />
                Record & AI
                <Icon name="arrow" />
              </button>
            </div>
          </div>
          <div className="continue-art">
            <div>
              <span className="folio-label">THE NEXT REHEARSAL</span>
              <div className="folio">{String(ctx.scene.scene.position + 1).padStart(2, '0')}</div>
            </div>
            <p className="role-label">
              <Icon name="file" />
              {ctx.scene.lines.length} lines in this scene
            </p>
          </div>
        </section>
      )}
      <div className="library-toolbar">
        <div className="tabs" role="tablist" aria-label="Script type">
          {[
            ['all', 'All scripts'],
            ['play', 'Plays'],
            ['scene', 'Scenes'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={'tab ' + (filter === key ? 'active' : '')}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              <span className="number">
                {ctx.data!.scripts.filter((s) => key === 'all' || s.kind === key).length}
              </span>
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" />
          <input
            placeholder="Search scripts"
            aria-label="Search scripts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="library-grid">{scripts.map(card)}</div>
      {!scripts.length && (
        <div className="empty">
          <Icon name="file" />
          <h2>
            {ctx.data!.scripts.length ? 'No scripts found.' : 'Your first script belongs here.'}
          </h2>
          <p>
            {ctx.data!.scripts.length
              ? 'Try another title or filter.'
              : 'Add a whole play or just the scene your cast needs.'}
          </p>
          {ctx.canEdit && !ctx.data!.scripts.length && (
            <button className="btn" onClick={() => ctx.open('import')}>
              Add your first script
            </button>
          )}
        </div>
      )}
      <p className="library-note">
        <Icon name="lock" />
        Shared only with {ctx.group!.name}.
      </p>
    </>
  );
}
export function SceneSetup({ ctx }: { ctx: Context }) {
  const { script } = ctx.script!;
  const scene = ctx.scene!.scene;
  const color = colors[script.color];
  return (
    <>
      <div className="detail-heading">
        <div className="mini-cover" style={{ background: color.bg, color: color.ink }}>
          <small>{script.author}</small>
          <span>{script.title}</span>
          <small>{script.kind === 'play' ? 'PLAY' : 'SCENE'}</small>
        </div>
        <div>
          <Pill kind="wine">{script.kind === 'play' ? 'Play' : 'Standalone scene'}</Pill>
          <h1>{script.title}</h1>
          <p className="muted">
            {script.author ? script.author + ' · ' : ''}
            {ctx.group!.name}
          </p>
        </div>
        {ctx.canEdit && (
          <div className="detail-actions">
            <button className="text-link" onClick={() => ctx.open('color')}>
              Cover color
            </button>
            <button className="text-link" onClick={() => ctx.go('editor')}>
              <Icon name="edit" />
              Edit script
            </button>
          </div>
        )}
      </div>
      <section className="audio-entry">
        <div>
          <span className="eyebrow">BRING THE SCRIPT TO LIFE</span>
          <h2>Record your cast. Give every role a voice.</h2>
          <p>{scene.title} · Record a take for any line, or prepare the missing voices with AI.</p>
        </div>
        <button className="btn" onClick={() => ctx.go('audio')}>
          <Icon name="mic" />
          Record & AI audio
          <Icon name="arrow" />
        </button>
      </section>
      <div className="detail-layout">
        <div className="panel">
          <div className="panel-header">
            <h2>{script.kind === 'play' ? 'Scenes' : 'Your scene'}</h2>
            <span className="small muted">{ctx.script!.scenes.length} total</span>
          </div>
          {ctx.script!.scenes.map((s) => (
            <button
              className={'scene-item scene-button ' + (s.id === scene.id ? 'selected' : '')}
              key={s.id}
              onClick={() => ctx.chooseScene(s.id)}
            >
              <span className="scene-number">{s.position + 1}</span>
              <span>
                <h3>{s.title}</h3>
                <p>
                  {s.line_count} lines ·{' '}
                  {s.missing_audio ? s.missing_audio + ' need audio' : 'Audio ready'}
                </p>
              </span>
              {s.id === scene.id ? <Icon name="check" /> : <Icon name="chevron" />}
            </button>
          ))}
        </div>
        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h2>Who’s here today?</h2>
              <Icon name="users" />
            </div>
            <div className="panel-content">
              <p className="inline-help">
                Choose the parts performed live. Pocket Partner reads the rest.
              </p>
              <Roles ctx={ctx} />
              <MyRole ctx={ctx} />
              <button className="btn full" onClick={() => ctx.chooseScene(scene.id, 'rehearse')}>
                <Icon name="play" />
                Start rehearsal
              </button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-content">
              <h3>Keep your scene close</h3>
              <p className="inline-help">
                Save its script and audio for 24 hours of offline rehearsal on this device.
              </p>
              <button
                className="text-link"
                disabled={!ctx.online}
                onClick={() => ctx.act(ctx.saveOffline)}
              >
                <Icon name="download" />
                Prepare offline
              </button>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
export function AudioStudio({ ctx }: { ctx: Context }) {
  const [role, setRole] = useState('all'),
    [preview, setPreview] = useState<string | null>(null);
  const scene = ctx.scene!;
  const pending = new Set(
    scene.jobs.filter((j) => ['queued', 'running'].includes(j.status)).map((j) => j.line_id),
  );
  const spoken = scene.lines.filter((l) => l.character_id);
  const lines = spoken.filter((l) => role === 'all' || l.character_id === role);
  const recorded = spoken.filter((l) => l.audio_kind === 'recorded').length,
    ai = spoken.filter((l) => l.audio_kind === 'ai').length;
  useEffect(() => {
    setRole('all');
    setPreview(null);
  }, [scene.scene.id]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function prepare(line?: Line) {
    const selected = line ? [line] : lines.filter((l) => !l.audio_id && !pending.has(l.id));
    const targets = selected.filter((l) => l.audio_kind !== 'recorded' && !pending.has(l.id));
    const chars = targets.reduce((n, l) => n + l.text.length, 0);
    if (!targets.length) {
      ctx.message('These lines already have audio or are being prepared.');
      return;
    }
    ctx.open('confirm', {
      title: line?.audio_id ? 'Regenerate this AI line?' : 'Prepare the missing voices',
      body: (
        <>
          <p>
            {targets.length} line{targets.length === 1 ? '' : 's'} · {chars.toLocaleString()}{' '}
            characters
          </p>
          <p>
            Your recordings are kept. This request uses your group’s AI allowance and sends the
            selected text to ElevenLabs.
          </p>
          <p>
            {Math.min(
              ctx.data!.budget.groupRemaining,
              ctx.data!.budget.globalRemaining,
            ).toLocaleString()}{' '}
            characters currently available.
          </p>
        </>
      ),
      label: 'Prepare audio',
      run: async () => {
        const r = await send('/scenes/' + scene.scene.id + '/generate', {
          lineIds: targets.map((l) => l.id),
          regenerate: !!line?.audio_id,
        });
        await ctx.reload();
        ctx.message(`${r.queued} lines queued for preparation.`);
      },
    });
  }
  const failed = new Map<string, string>();
  for (const j of scene.jobs)
    if (j.status === 'failed' && !failed.has(j.line_id))
      failed.set(j.line_id, j.error || 'Preparation failed.');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Every voice, in one place.</h1>
          <p>Record your cast or prepare the scene with AI.</p>
        </div>
        <button className="btn secondary" onClick={() => ctx.go('rehearse')}>
          <Icon name="play" />
          Rehearse
        </button>
      </div>
      <div className="audio-context">
        <label className="field">
          Script
          <select
            className="input"
            value={ctx.script!.script.id}
            onChange={(e) => ctx.chooseScript(e.target.value, 'audio')}
          >
            {ctx.data!.scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Scene
          <select
            className="input"
            value={scene.scene.id}
            onChange={(e) => ctx.chooseScene(e.target.value, 'audio')}
          >
            {ctx.script!.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        {ctx.canEdit && (
          <button className="text-link" onClick={() => ctx.go('editor')}>
            <Icon name="edit" />
            Edit words
          </button>
        )}
      </div>
      <section className="audio-hero">
        <div>
          <div className="eyebrow">YOUR SCENE, YOUR VOICES</div>
          <h2>Start with AI. Make it your own.</h2>
          <p>
            Choose each character’s voice, then replace any line with a recording from your cast.
          </p>
          <div className="audio-summary">
            <Pill kind="wine">{recorded} recorded</Pill>
            <Pill kind="gold">{ai} AI lines</Pill>
            <Pill>{spoken.length - recorded - ai} need audio</Pill>
            {pending.size > 0 && <Pill>{pending.size} preparing</Pill>}
          </div>
        </div>
        {ctx.canEdit && (
          <div className="audio-hero-actions">
            <button
              className="btn"
              disabled={!ctx.online || !ctx.data!.budget.enabled}
              onClick={() => prepare()}
            >
              <Icon name="spark" />
              Prepare {role === 'all' ? 'scene' : 'character'} with AI
            </button>
            <button
              className="btn secondary"
              disabled={!ctx.online}
              onClick={() => ctx.open('voices')}
            >
              <Icon name="settings" />
              Character voices & delivery
            </button>
            <small>
              {Math.min(
                ctx.data!.budget.groupRemaining,
                ctx.data!.budget.globalRemaining,
              ).toLocaleString()}{' '}
              AI characters available this month
            </small>
          </div>
        )}
      </section>
      <div className="section-heading">
        <div>
          <h2>{ctx.canEdit ? 'Record or replace a line' : 'Listen to the scene'}</h2>
          <p className="muted small">
            {ctx.canEdit
              ? 'Each take replaces the selected line’s audio.'
              : 'Editors can prepare and replace recordings.'}
          </p>
        </div>
        <span className="small muted">{lines.length} lines</span>
      </div>
      <div className="audio-role-tabs" aria-label="Filter by character">
        <button className={role === 'all' ? 'active' : ''} onClick={() => setRole('all')}>
          All characters
        </button>
        {ctx
          .script!.characters.filter((c) => spoken.some((l) => l.character_id === c.id))
          .map((c) => (
            <button
              key={c.id}
              className={role === c.id ? 'active' : ''}
              onClick={() => setRole(c.id)}
            >
              {c.name}
            </button>
          ))}
      </div>
      {preview && <audio className="audio-preview" controls autoPlay src={preview} />}
      <div className="audio-lines">
        {lines.map((l) => (
          <article className="audio-line" key={l.id}>
            <div className="audio-line-top">
              <b>
                {l.speaker} <span>· {l.position + 1}</span>
              </b>
              <Pill kind={l.audio_kind === 'recorded' ? 'wine' : 'gold'}>
                {pending.has(l.id)
                  ? 'Preparing…'
                  : l.audio_kind === 'recorded'
                    ? 'Recorded'
                    : l.audio_id
                      ? 'AI voice'
                      : 'Needs audio'}
              </Pill>
            </div>
            <p>{l.text}</p>
            {!l.audio_id && !pending.has(l.id) && failed.has(l.id) && (
              <p className="audio-error">{failed.get(l.id)}</p>
            )}
            <div className="audio-line-actions">
              {ctx.canEdit && (
                <>
                  <button
                    className={'btn ' + (l.audio_kind === 'recorded' ? 'secondary' : '')}
                    disabled={!ctx.online}
                    onClick={() => ctx.open('record', l)}
                  >
                    <Icon name="mic" />
                    {l.audio_kind === 'recorded' ? 'Record again' : 'Record line'}
                  </button>
                  <button
                    className="text-link"
                    disabled={!ctx.online || l.audio_kind === 'recorded' || pending.has(l.id)}
                    onClick={() => prepare(l)}
                  >
                    <Icon name="spark" />
                    {l.audio_id ? 'Regenerate AI' : 'Generate AI'}
                  </button>
                </>
              )}
              <button
                className="icon-btn"
                aria-label={'Listen to line ' + (l.position + 1)}
                disabled={!l.audio_id}
                onClick={() =>
                  ctx.act(async () => setPreview(URL.createObjectURL(await audioBlob(l.audio_id!))))
                }
              >
                <Icon name="play" />
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="library-note">
        <Icon name="lock" />
        Recordings stay in your group. Only selected AI text is sent to the voice provider.
      </p>
    </>
  );
}
export function Editor({ ctx }: { ctx: Context }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="editor-top">
        <div>
          <button className="text-link" onClick={() => ctx.go('scene')}>
            <Icon name="back" />
            Back to scenes
          </button>
          <h1>Script editor</h1>
          <p className="muted">
            {ctx.script!.script.title} · {ctx.scene!.scene.title}
          </p>
        </div>
        <button className="btn" onClick={() => ctx.go('audio')}>
          <Icon name="mic" />
          Record & AI
        </button>
      </div>
      <div className="panel">
        <table className="editor-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Character</th>
              <th>Line</th>
              <th>Audio</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ctx.scene!.lines.map((l) => (
              <tr key={l.id}>
                <td className="line-index">{l.position + 1}</td>
                <td className="speaker-cell">{l.speaker || 'Stage direction'}</td>
                <td className="line-text">{l.text}</td>
                <td className="audio-type">
                  <Pill>{l.audio_kind || 'No audio'}</Pill>
                </td>
                <td>
                  <div className="editor-actions">
                    {ctx.canEdit && (
                      <>
                        <button
                          className="icon-btn"
                          aria-label={'Edit line ' + (l.position + 1)}
                          onClick={() => ctx.open('edit', l)}
                        >
                          <Icon name="edit" />
                        </button>
                        {l.character_id && (
                          <button
                            className="icon-btn"
                            aria-label={'Record line ' + (l.position + 1)}
                            onClick={() => ctx.open('record', l)}
                          >
                            <Icon name="mic" />
                          </button>
                        )}
                        <button
                          className="icon-btn danger"
                          aria-label={'Delete line ' + (l.position + 1)}
                          onClick={() =>
                            ctx.open('confirm', {
                              title: 'Delete this line?',
                              body: 'The text, selected audio and practice history for this line will be removed.',
                              danger: true,
                              label: 'Delete line',
                              run: async () => {
                                await send('/lines/' + l.id, {}, 'DELETE');
                                await ctx.reload();
                              },
                            })
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ctx.canEdit && (
        <>
          <button className="btn secondary modal-primary" onClick={() => setAdding(!adding)}>
            <Icon name="plus" />
            Add a line
          </button>
          {adding && (
            <form
              className="panel panel-content add-line-form"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                ctx.act(async () => {
                  await send('/scenes/' + ctx.scene!.scene.id + '/lines', {
                    speaker: d.get('speaker') || null,
                    text: d.get('text'),
                  });
                  setAdding(false);
                  await ctx.reload();
                });
              }}
            >
              <label className="field">
                Character (blank for stage directions)
                <input className="input" name="speaker" maxLength={60} list="character-names" />
                <datalist id="character-names">
                  {ctx.script!.characters.map((c) => (
                    <option key={c.id}>{c.name}</option>
                  ))}
                </datalist>
              </label>
              <label className="field">
                Text
                <textarea className="input" name="text" required maxLength={12000} />
              </label>
              <button className="btn">Add line</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
export function PracticeView({ ctx }: { ctx: Context }) {
  const scenes = new Map<string, Practice[]>();
  for (const r of ctx.practice) {
    const list = scenes.get(r.scene_id) || [];
    list.push(r);
    scenes.set(r.scene_id, list);
  }
  function practice(r: Practice, whole = false) {
    ctx.chooseScript(r.script_id, 'rehearse');
    ctx.chooseScene(r.scene_id, 'rehearse', whole ? undefined : r.line_id);
  }
  const why = (r: Practice) =>
    [
      r.repeats ? `${r.repeats} repeated cues` : '',
      r.hints ? `${r.hints} hints` : '',
      r.remembered ? `${r.remembered} remembered` : '',
      r.saved ? 'Saved by you' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>My practice</h1>
          <p>A little more time with the lines that need it.</p>
        </div>
        <Pill>
          <Icon name="lock" />
          Only you
        </Pill>
      </div>
      <div className="practice-explainer">
        <span>
          <Icon name="repeat" />
          Suggested from your hints and repeated cues.
        </span>
        <button
          className="text-link"
          onClick={() =>
            ctx.open('info', {
              title: 'Small repetitions, steady progress',
              body: (
                <div className="practice-explanation">
                  <p>
                    Repeating a cue adds 2 to your current line’s priority. A hint adds 3, once per
                    visit. Marking a line Remembered subtracts 2, down to zero.
                  </p>
                  <p>
                    Lines with priority 2 or more are suggested, with the highest priority first.
                    Saved lines stay until you unsave them. Scenes gather those lines together.
                  </p>
                  <p>
                    Only the part you select as “My part” counts toward your history. Continuing,
                    pausing and looping don’t change it.
                  </p>
                  <p>
                    These are suggestions for rehearsal, not an assessment of your memory or acting.
                  </p>
                </div>
              ),
            })
          }
        >
          How it works
          <Icon name="info" />
        </button>
      </div>
      <div className="progress-cards">
        <div className="stat-card">
          <Icon name="file" />
          <strong>{scenes.size}</strong>
          <p>Scenes to revisit</p>
        </div>
        <div className="stat-card">
          <Icon name="repeat" />
          <strong>{ctx.practice.filter((r) => r.score >= 2).length}</strong>
          <p>Lines needing practice</p>
        </div>
        <div className="stat-card">
          <Icon name="bookmark" />
          <strong>{ctx.practice.filter((r) => r.saved).length}</strong>
          <p>Saved by you</p>
        </div>
      </div>
      {ctx.practice.length ? (
        <>
          <div className="section-heading">
            <h2>Scenes to come back to</h2>
          </div>
          <div className="practice-scenes">
            {[...scenes].map(([id, rows]) => (
              <article className="practice-scene" key={id}>
                <div className="scene-symbol">
                  <Icon name="file" />
                </div>
                <div>
                  <small>{rows[0].script_title}</small>
                  <h3>{rows[0].scene_title}</h3>
                  <p>{rows.length} lines to revisit</p>
                </div>
                <button className="btn secondary" onClick={() => practice(rows[0], true)}>
                  <Icon name="play" />
                  Practice scene
                </button>
              </article>
            ))}
          </div>
          <div className="section-heading">
            <h2>Give these another go</h2>
            <span className="small muted">Practice priority</span>
          </div>
          <div className="panel">
            {ctx.practice.map((r) => (
              <article className="practice-item" key={r.line_id}>
                <div>
                  <div className="practice-meta">
                    <small>
                      {r.speaker || 'Stage direction'} · {r.scene_title} · LINE {r.position + 1}
                    </small>
                    <Pill kind={r.score >= 8 ? 'wine' : 'gold'}>
                      {r.score >= 8 ? 'Extra attention' : r.score >= 2 ? 'Revisit' : 'Saved'}
                    </Pill>
                  </div>
                  <p>“{r.text}”</p>
                  <small>{why(r)}</small>
                  <div className="practice-actions">
                    <button className="btn secondary" onClick={() => practice(r)}>
                      <Icon name="play" />
                      Practice line
                    </button>
                    {r.score >= 2 && (
                      <button
                        className="text-link"
                        onClick={() =>
                          ctx.act(async () => {
                            await ctx.recordPractice(r.line_id, 'remembered');
                            await ctx.reload();
                          })
                        }
                      >
                        <Icon name="check" />
                        Remembered
                      </button>
                    )}
                    {r.saved && (
                      <button
                        className="text-link"
                        onClick={() =>
                          ctx.act(async () => {
                            await ctx.recordPractice(r.line_id, 'unsave');
                            await ctx.reload();
                          })
                        }
                      >
                        Unsave
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="panel empty">
          <Icon name="check" />
          <h2>Nothing needs another go yet.</h2>
          <p>Hints, repeated cues and saved lines will bring suggestions here.</p>
          <button className="btn secondary" onClick={() => ctx.go('scene')}>
            Choose a scene
          </button>
        </div>
      )}
    </>
  );
}
export function GroupView({ ctx }: { ctx: Context }) {
  const group = ctx.group!,
    owner = ctx.data!.role === 'owner';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your groups</h1>
          <p>A separate space for every company you rehearse with.</p>
        </div>
        <button className="btn" onClick={() => ctx.open('group')}>
          <Icon name="plus" />
          Create group
        </button>
      </div>
      <div className="group-tabs">
        {ctx.me.groups.map((g) => (
          <button
            key={g.id}
            className={g.id === group.id ? 'active' : ''}
            onClick={() => ctx.chooseGroup(g.id)}
          >
            <Icon name="users" />
            {g.name}
          </button>
        ))}
      </div>
      <div className="group-banner">
        <div className="group-monogram">
          {group.name
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0])
            .join('')
            .toUpperCase()}
        </div>
        <div>
          <h2>{group.name}</h2>
          <p>
            {ctx.data!.members.length} members · {ctx.data!.scripts.length} scripts · Your role:{' '}
            {ctx.data!.role}
          </p>
        </div>
        <Pill kind="green">
          <Icon name="lock" />
          Private group
        </Pill>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>The company</h2>
          {owner && (
            <button className="text-link" onClick={() => ctx.open('invite')}>
              <Icon name="plus" />
              Invite member
            </button>
          )}
        </div>
        {ctx.data!.members.map((m) => (
          <div className="member" key={m.uid}>
            <span className="avatar">{(m.name || m.email).slice(0, 2).toUpperCase()}</span>
            <div>
              <h3>
                {m.name || m.email}
                {m.uid === ctx.user.uid ? ' (you)' : ''}
              </h3>
              <p>{m.email}</p>
            </div>
            {owner && m.role !== 'owner' ? (
              <>
                <select
                  className="settings-select member-role"
                  aria-label={'Access for ' + m.name}
                  value={m.role}
                  onChange={(e) =>
                    ctx.act(async () => {
                      await send(
                        '/groups/' + group.id + '/members/' + m.uid,
                        { role: e.target.value },
                        'PATCH',
                      );
                      await ctx.reload();
                    })
                  }
                >
                  <option value="member">Member</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  className="icon-btn danger"
                  aria-label={'Remove ' + m.name}
                  onClick={() =>
                    ctx.open('confirm', {
                      title: 'Remove ' + m.name + '?',
                      body: 'They will lose online access to this group. Previously downloaded material may remain available offline until it expires.',
                      label: 'Remove member',
                      danger: true,
                      run: async () => {
                        await send('/groups/' + group.id + '/members/' + m.uid, {}, 'DELETE');
                        await ctx.reload();
                      },
                    })
                  }
                >
                  <Icon name="close" />
                </button>
              </>
            ) : (
              <Pill kind={m.role === 'owner' ? 'wine' : ''}>{m.role}</Pill>
            )}
          </div>
        ))}
      </div>
      {owner && (
        <>
          <div className="panel group-invites">
            <div className="panel-header">
              <h2>Invitation links</h2>
              <button className="text-link" onClick={() => ctx.act(ctx.reload)}>
                Refresh
              </button>
            </div>
            <div className="panel-content">
              {ctx.data!.invitations.length ? (
                ctx.data!.invitations.map((i) => (
                  <div className="setting-row" key={i.id}>
                    <span>
                      <b>{i.role === 'editor' ? 'Editor' : 'Member'} invitation</b>
                      <small>
                        {i.revoked_at
                          ? 'Revoked'
                          : i.used_at
                            ? 'Accepted'
                            : new Date(i.expires_at) < new Date()
                              ? 'Expired'
                              : 'Expires ' + new Date(i.expires_at).toLocaleDateString()}
                      </small>
                    </span>
                    {!i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date() && (
                      <button
                        className="text-link danger"
                        onClick={() =>
                          ctx.act(async () => {
                            await send(
                              '/groups/' + group.id + '/invitations/' + i.id,
                              {},
                              'DELETE',
                            );
                            await ctx.reload();
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="inline-help">
                  Create a link and share it with one person. No email setup is needed.
                </p>
              )}
            </div>
          </div>
          <button
            className="text-link danger delete-group"
            onClick={() =>
              ctx.open('confirm', {
                title: 'Delete ' + group.name + '?',
                body: 'This deletes the group, its scripts, recordings and members’ practice history. This cannot be undone.',
                label: 'Delete group',
                danger: true,
                run: async () => {
                  await send('/groups/' + group.id, {}, 'DELETE');
                  await ctx.reload();
                  ctx.chooseGroup(ctx.me.groups.find((g) => g.id !== group.id)?.id || '');
                },
              })
            }
          >
            Delete group
          </button>
        </>
      )}
    </>
  );
}
export function AccountView({ ctx }: { ctx: Context }) {
  const [prepared, setPrepared] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    offline.get<any[]>(ctx.user.uid, 'prepared').then((s) => setPrepared(s || []));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your preferences</h1>
          <p>Your account and rehearsal data.</p>
        </div>
      </div>
      <div className="account-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Your profile</h2>
          </div>
          <form
            className="panel-content"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              setBusy(true);
              ctx.act(async () => {
                try {
                  await send('/me', { name: d.get('name') }, 'PATCH');
                  await ctx.reload();
                  ctx.message('Profile updated.');
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            <label className="field">
              Name
              <input
                className="input"
                name="name"
                required
                maxLength={60}
                defaultValue={ctx.me.user.name}
              />
            </label>
            <label className="field">
              Email address
              <input className="input" readOnly value={ctx.user.email || ''} />
            </label>
            <button className="btn" disabled={busy}>
              Save changes
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Offline scenes</h2>
          </div>
          <div className="panel-content">
            {prepared
              .filter((s) => s.expires > Date.now())
              .map((s) => (
                <div className="setting-row" key={s.id}>
                  <span>
                    <b>{s.title}</b>
                    <small>
                      {s.scene} · until {new Date(s.expires).toLocaleString()}
                    </small>
                  </span>
                  <Icon name="download" />
                </div>
              ))}
            {!prepared.length && (
              <p className="inline-help">
                Prepare a scene from its setup page to rehearse without a connection.
              </p>
            )}
            <button
              className="text-link danger"
              onClick={() =>
                ctx.act(async () => {
                  await offline.clear(ctx.user.uid);
                  setPrepared([]);
                  ctx.message('Downloaded scenes removed from this device.');
                })
              }
            >
              Remove offline data
            </button>
            <p className="input-hint">
              Downloads expire after 24 hours and are removed when you sign out. Offline access
              cannot immediately reflect membership changes.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Account access</h2>
          </div>
          <div className="panel-content">
            <button
              className="btn secondary full"
              onClick={() =>
                ctx.act(async () => {
                  await sendPasswordResetEmail(ctx.auth, ctx.user.email!);
                  ctx.message('Password-reset email requested.');
                })
              }
            >
              Reset password
            </button>
            <button className="text-link" onClick={() => ctx.act(ctx.logout)}>
              <Icon name="logout" />
              Sign out
            </button>
            <button
              className="text-link danger"
              onClick={() =>
                ctx.open('info', {
                  title: 'Delete your account',
                  body: (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        ctx.act(async () => {
                          await reauthenticateWithCredential(
                            ctx.user,
                            EmailAuthProvider.credential(
                              ctx.user.email!,
                              String(d.get('password')),
                            ),
                          );
                          await send('/me', {}, 'DELETE');
                          await ctx.logout();
                        });
                      }}
                    >
                      <p className="modal-description">
                        Delete groups you own first. Your account and personal practice history will
                        be removed.
                      </p>
                      <label className="field">
                        Confirm your password
                        <input
                          type="password"
                          className="input"
                          name="password"
                          required
                          autoComplete="current-password"
                        />
                      </label>
                      <button className="btn danger-btn">Delete account permanently</button>
                    </form>
                  ),
                })
              }
            >
              Delete account
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>About Pocket Partner</h2>
          </div>
          <div className="panel-content">
            <p className="inline-help">
              A mobile rehearsal partner built as a group exercise for the{' '}
              <a
                className="text-link"
                href="https://www.formation-continue-unil-epfl.ch/formation/ai-product-management/"
                target="_blank"
                rel="noreferrer"
              >
                UNIL–EPFL AI Product Management course
              </a>
              .
            </p>
            <p className="input-hint">
              Scripts and recordings are private to your group. AI preparation sends selected script
              lines to ElevenLabs. Firebase handles email/password sign-in.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
