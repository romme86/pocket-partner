import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { api, send } from './api';
import { Icon } from './icons';
import {
  colors,
  type Group,
  type Script,
  type ScriptData,
  type Line,
  type Character,
} from './types';
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-btn" aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
export function NewGroup({
  close,
  created,
}: {
  close: () => void;
  created: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title="A space for your company" close={close}>
      <p className="modal-description">
        Create a private group for a cast, production or workshop. You can create more than one.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const r = await send('/groups', { name: d.get('name') });
            await created(r.id);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            name="name"
            className="input"
            required
            maxLength={60}
            autoFocus
            placeholder="Saturday Company"
          />
        </div>
        <p className="inline-help">You’ll be the owner. Invite your cast and add a script next.</p>
        <ErrorText error={error} />
        <button className="btn full modal-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create group'}
          <Icon name="plus" />
        </button>
      </form>
    </Dialog>
  );
}
type Draft = { title: string; lines: { speaker: string | null; text: string }[] };
export function ImportScript({
  group,
  close,
  created,
}: {
  group: Group;
  close: () => void;
  created: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<'play' | 'scene'>('play'),
    [title, setTitle] = useState(''),
    [author, setAuthor] = useState(''),
    [text, setText] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [scenes, setScenes] = useState<Draft[] | null>(null),
    [originalFileId, setOriginal] = useState<string | null>(null),
    [sceneIndex, setSceneIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function preview(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = new FormData();
      data.set('kind', kind);
      if (file) data.set('file', file);
      else data.set('text', text);
      const r = await api<{ scenes: Draft[]; originalFileId: string | null }>(
        '/groups/' + group.id + '/import-preview',
        { method: 'POST', body: data },
      );
      setScenes(r.scenes);
      setOriginal(r.originalFileId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function updateLine(i: number, key: 'speaker' | 'text', value: string) {
    setScenes((prev) =>
      prev!.map((s, n) =>
        n === sceneIndex
          ? {
              ...s,
              lines: s.lines.map((l, x) =>
                x === i ? { ...l, [key]: key === 'speaker' ? value || null : value } : l,
              ),
            }
          : s,
      ),
    );
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (!scenes?.some((s) => s.lines.some((l) => l.speaker)))
        throw new Error('Add a character name to each spoken line before importing.');
      const r = await send('/groups/' + group.id + '/scripts', {
        title,
        author,
        kind,
        scenes,
        originalFileId,
      });
      await created(r.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title={scenes ? 'Check the words and roles' : 'A new part to play'} close={close}>
      {!scenes ? (
        <form onSubmit={preview}>
          <p className="modal-description">
            Add a whole play or one scene to <b>{group.name}</b>.
          </p>
          <div className="choice-cards">
            {(['play', 'scene'] as const).map((t) => (
              <button
                type="button"
                key={t}
                className={'choice-card ' + (t === kind ? 'selected' : '')}
                aria-pressed={t === kind}
                onClick={() => setKind(t)}
              >
                <Icon name={t === 'play' ? 'library' : 'file'} />
                <span>
                  <b>{t === 'play' ? 'A whole play' : 'Just a scene'}</b>
                  <small>
                    {t === 'play' ? 'Organize it into scenes' : 'No full play required'}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="script-title">Title</label>
            <input
              id="script-title"
              className="input"
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="script-author">Author (optional)</label>
            <input
              id="script-author"
              className="input"
              maxLength={160}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <label className="dropzone">
            <Icon name="upload" />
            <b>{file?.name || 'Choose your script'}</b>
            <span>Text-based PDF or UTF-8 TXT · up to 10 MB</span>
            <input
              className="sr-only"
              type="file"
              accept=".pdf,.txt"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setText('');
              }}
            />
          </label>
          {file ? (
            <button type="button" className="text-link" onClick={() => setFile(null)}>
              Remove file
            </button>
          ) : (
            <>
              <div className="or">OR PASTE TEXT</div>
              <textarea
                className="input"
                value={text}
                maxLength={200000}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  'HERMIA: I am amazed at your passionate words.\nHELENA: Have you not set Lysander, as in scorn…'
                }
                required
                rows={6}
                aria-label="Script text"
              />
            </>
          )}
          <p className="input-hint">
            Character names followed by a colon work best. Scanned images need OCR before upload.
          </p>
          <ErrorText error={error} />
          <button className="btn full modal-primary" disabled={busy || (!file && !text.trim())}>
            {busy ? 'Reading your script…' : 'Review script'}
            <Icon name="arrow" />
          </button>
        </form>
      ) : (
        <>
          <p className="modal-description">
            {title} · {scenes.length} scene{scenes.length === 1 ? '' : 's'}. Correct the labels
            below. Leave a character blank for stage directions.
          </p>
          <div className="field">
            <label htmlFor="review-scene">Scene to review</label>
            <select
              id="review-scene"
              className="input"
              value={sceneIndex}
              onChange={(e) => setSceneIndex(Number(e.target.value))}
            >
              {scenes.map((s, i) => (
                <option value={i} key={i}>
                  {s.title} · {s.lines.length} lines
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="scene-title">Scene title</label>
            <input
              id="scene-title"
              className="input"
              value={scenes[sceneIndex].title}
              maxLength={160}
              onChange={(e) =>
                setScenes((prev) =>
                  prev!.map((s, i) => (i === sceneIndex ? { ...s, title: e.target.value } : s)),
                )
              }
            />
          </div>
          <div className="review-lines">
            {scenes[sceneIndex].lines.map((l, i) => (
              <div className="review-line" key={i}>
                <label>
                  Character
                  <input
                    className="input"
                    value={l.speaker || ''}
                    maxLength={60}
                    placeholder="Stage direction"
                    onChange={(e) => updateLine(i, 'speaker', e.target.value)}
                  />
                </label>
                <label>
                  Line {i + 1}
                  <textarea
                    className="input"
                    value={l.text}
                    maxLength={12000}
                    rows={3}
                    onChange={(e) => updateLine(i, 'text', e.target.value)}
                  />
                </label>
                <div className="between">
                  <button
                    className="text-link danger"
                    onClick={() =>
                      setScenes((prev) =>
                        prev!.map((s, n) =>
                          n === sceneIndex ? { ...s, lines: s.lines.filter((_, x) => x !== i) } : s,
                        ),
                      )
                    }
                  >
                    Remove line
                  </button>
                  {kind === 'play' && i > 0 && (
                    <button
                      className="text-link"
                      onClick={() => {
                        const copy = [...scenes];
                        const curr = copy[sceneIndex];
                        copy.splice(
                          sceneIndex,
                          1,
                          { ...curr, lines: curr.lines.slice(0, i) },
                          { title: 'New scene', lines: curr.lines.slice(i) },
                        );
                        setScenes(copy);
                        setSceneIndex(sceneIndex + 1);
                      }}
                    >
                      Start a scene here
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            className="text-link"
            onClick={() =>
              setScenes((prev) =>
                prev!.map((s, n) =>
                  n === sceneIndex ? { ...s, lines: [...s.lines, { speaker: null, text: '' }] } : s,
                ),
              )
            }
          >
            <Icon name="plus" />
            Add a line
          </button>
          <ErrorText error={error} />
          <div className="modal-inline-footer">
            <button className="btn secondary" onClick={() => setScenes(null)} disabled={busy}>
              Back
            </button>
            <button
              className="btn"
              onClick={save}
              disabled={
                busy ||
                scenes.some(
                  (s) => !s.title.trim() || !s.lines.length || s.lines.some((l) => !l.text.trim()),
                )
              }
            >
              {busy ? 'Saving…' : 'Add to library'}
              <Icon name="check" />
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
export function RecordLine({
  line,
  close,
  saved,
}: {
  line: Line;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [blob, setBlob] = useState<Blob | null>(null),
    [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
  }
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.state === 'recording' && recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  async function start() {
    setError('');
    setSeconds(0);
    setBlob(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error('Recording needs a supported browser and a secure HTTPS connection.');
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      recorder.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        const b = new Blob(chunks, { type: r.mimeType });
        if (b.size > 10 * 1024 * 1024) setError('This take is too large. Record a shorter line.');
        else setBlob(b);
      };
      r.start(500);
      setRecording(true);
      const began = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= 180) stop();
      }, 250);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Allow microphone access in your browser to record this line.'
          : (e as Error).message,
      );
    }
  }
  async function save() {
    if (!blob) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', blob, 'take');
      form.set('revision', String(line.revision));
      await api('/lines/' + line.id + '/recording', { method: 'POST', body: form });
      await saved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="Make this line your own" close={close}>
      <p className="modal-description">
        {line.speaker} · Line {line.position + 1}
      </p>
      <div className="record-quote">{line.text}</div>
      {blob ? (
        <>
          <audio controls src={url} className="record-player" />
          <button
            className="text-link"
            onClick={() => {
              setBlob(null);
              setSeconds(0);
            }}
          >
            <Icon name="repeat" />
            Try another take
          </button>
        </>
      ) : (
        <div className="record-area">
          <button
            className={'record-circle ' + (recording ? 'recording' : '')}
            onClick={recording ? stop : start}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
          >
            <Icon name={recording ? 'stop' : 'mic'} />
          </button>
          <div className="record-time">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </div>
          <p>{recording ? 'Recording…' : 'Tap to record · up to 3 minutes'}</p>
        </div>
      )}
      <ErrorText error={error} />
      <p className="input-hint">Your new take replaces the selected audio for this line.</p>
      <button
        className="btn full modal-primary"
        disabled={!blob || recording || busy}
        onClick={save}
      >
        {busy ? 'Saving your take…' : 'Use this take'}
        <Icon name="check" />
      </button>
    </Dialog>
  );
}
export function VoiceSettings({
  script,
  close,
  saved,
}: {
  script: ScriptData;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<{ id: string; name: string; description: string }[]>([]),
    [characters, setCharacters] = useState(script.characters),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/voices')
      .then((r) => setCatalog(r.voices))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Dialog title="Give every role a voice" close={close}>
      <p className="modal-description">
        Choose a voice per character. Neutral delivery helps with learning; expressive delivery adds
        variation.
      </p>
      {characters.map((c, i) => (
        <div className="voice-setting" key={c.id}>
          <b>{c.name}</b>
          <label>
            Voice
            <select
              className="input"
              value={c.voice_id}
              onChange={(e) =>
                setCharacters((prev) =>
                  prev.map((c, n) => (i === n ? { ...c, voice_id: e.target.value } : c)),
                )
              }
            >
              <option value="">Choose a voice</option>
              {catalog.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.name}
                  {v.description ? ' · ' + v.description : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" aria-label={'Delivery for ' + c.name}>
            {(['neutral', 'expressive'] as const).map((d) => (
              <button
                key={d}
                className={c.delivery === d ? 'selected' : ''}
                onClick={() =>
                  setCharacters((prev) => prev.map((c, n) => (i === n ? { ...c, delivery: d } : c)))
                }
                aria-pressed={c.delivery === d}
              >
                {d === 'neutral' ? 'Neutral' : 'Expressive'}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="input-hint">
        These settings apply to new AI audio. Use Regenerate AI to replace an existing AI line. Your
        recordings are kept.
      </p>
      <ErrorText error={error} />
      <button
        className="btn full modal-primary"
        disabled={busy || !catalog.length}
        onClick={async () => {
          setBusy(true);
          try {
            for (const c of characters) {
              const old = script.characters.find((x) => x.id === c.id)!;
              if (c.voice_id && (c.voice_id !== old.voice_id || c.delivery !== old.delivery))
                await send(
                  '/characters/' + c.id,
                  { voiceId: c.voice_id, delivery: c.delivery },
                  'PATCH',
                );
            }
            await saved();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Save voices'}
        <Icon name="check" />
      </button>
    </Dialog>
  );
}
export function InviteGroup({ group, close }: { group: Group; close: () => void }) {
  const [role, setRole] = useState('member'),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  return (
    <Dialog title="Bring your company together" close={close}>
      <p className="modal-description">
        Invite someone to {group.name}. Each link can be used once and expires after 7 days. Anyone
        you share it with can sign in and join.
      </p>
      {url ? (
        <>
          <label className="field">
            Invitation link
            <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="btn full"
            onClick={() =>
              navigator.clipboard
                .writeText(url)
                .then(() => setCopied(true))
                .catch(() => setError('Select the link above and copy it.'))
            }
          >
            <Icon name="check" />
            {copied ? 'Copied' : 'Copy invitation link'}
          </button>
          <p className="input-hint">
            Share this link with your cast yourself. No email has been sent.
          </p>
        </>
      ) : (
        <>
          <label className="field">
            Access
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member · rehearse shared scripts</option>
              <option value="editor">Editor · also edit scripts and audio</option>
            </select>
          </label>
          <button
            className="btn full modal-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setUrl((await send('/groups/' + group.id + '/invitations', { role })).url);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Create invitation link
            <Icon name="arrow" />
          </button>
        </>
      )}
      <ErrorText error={error} />
    </Dialog>
  );
}
export function ColorPicker({
  script,
  close,
  saved,
}: {
  script: Script;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title="A color for this script" close={close}>
      <p className="modal-description">
        {script.title}
        <br />
        Colors help identify your scripts. Everyone in the group sees the same cover.
      </p>
      <div className="color-options">
        {colors.map((c, i) => (
          <button
            key={c.name}
            className={'color-option ' + (i === script.color ? 'selected' : '')}
            disabled={busy}
            aria-pressed={script.color === i}
            onClick={async () => {
              setBusy(true);
              try {
                await send('/scripts/' + script.id, { color: i }, 'PATCH');
                await saved();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            <span style={{ background: c.bg, color: c.ink }}>
              Aa{i === script.color && <Icon name="check" />}
            </span>
            <b>{c.name}</b>
          </button>
        ))}
      </div>
      <ErrorText error={error} />
    </Dialog>
  );
}
export function EditLine({
  line,
  characters,
  close,
  saved,
}: {
  line: Line;
  characters: Character[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title="Keep the words right" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await send(
              '/lines/' + line.id,
              { text: d.get('text'), characterId: d.get('character') || null },
              'PATCH',
            );
            await saved();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Character
          <select className="input" name="character" defaultValue={line.character_id || ''}>
            <option value="">Stage direction</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Line {line.position + 1}
          <textarea
            className="input"
            rows={6}
            name="text"
            defaultValue={line.text}
            required
            maxLength={12000}
          />
        </label>
        <p className="input-hint">
          Changed words need new audio. Practice history for this line will start again.
        </p>
        <ErrorText error={error} />
        <button className="btn full modal-primary" disabled={busy}>
          Save line
          <Icon name="check" />
        </button>
      </form>
    </Dialog>
  );
}
export function ConfirmAction({
  title,
  body,
  label = 'Continue',
  run,
  close,
  danger = false,
}: {
  title: string;
  body: ReactNode;
  label?: string;
  run: () => Promise<void>;
  close: () => void;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title={title} close={close}>
      <div className="modal-description">{body}</div>
      <ErrorText error={error} />
      <div className="modal-inline-footer">
        <button className="btn secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          className={'btn ' + (danger ? 'danger-btn' : '')}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await run();
              close();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'One moment…' : label}
        </button>
      </div>
    </Dialog>
  );
}
