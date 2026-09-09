import { useEffect, useRef, useState } from 'react';
import type { Context } from './App';
import type { Line, Practice } from './types';
import { audioBlob, api } from './api';
import { Icon } from './icons';
import { Pill, Roles, MyRole } from './views';
import { Dialog } from './modals';
export function contextWindow(lines: Line[], index: number) {
  const start = Math.max(0, Math.min(index - 2, Math.max(0, lines.length - 5)));
  return lines.slice(start, start + 5).map((line, offset) => ({ line, index: start + offset }));
}
export function Rehearsal({ ctx }: { ctx: Context }) {
  const lines = ctx.scene!.lines;
  const initial = Math.max(
    0,
    lines.findIndex((l) => l.id === ctx.startLine),
  );
  const [cursor, setCursor] = useState(initial),
    [auto, setAuto] = useState(false),
    [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState(false),
    [paused, setPaused] = useState(false),
    [hide, setHide] = useState(false),
    [hint, setHint] = useState(false),
    [loop, setLoop] = useState(false),
    [rangeStart, setRangeStart] = useState(0),
    [rangeEnd, setRangeEnd] = useState(lines.length - 1),
    [speed, setSpeed] = useState(1),
    [settings, setSettings] = useState(false),
    [saved, setSaved] = useState(
      new Set(ctx.practice.filter((l) => l.saved).map((l) => l.line_id)),
    );
  const audio = useRef<HTMLAudioElement | null>(null),
    reader = useRef<HTMLDivElement>(null),
    playback = useRef(0),
    objectUrl = useRef('');
  const finished = cursor >= lines.length;
  const line = lines[cursor];
  const isLive = !!line?.character_id && ctx.live.has(line.character_id);
  const isMine = !!line?.character_id && line.character_id === ctx.myRole;
  const hintUsed = useRef(false);
  useEffect(() => {
    hintUsed.current = false;
  }, [cursor]);
  function stop() {
    playback.current++;
    audio.current?.pause();
    setPlaying(false);
    setLoading(false);
  }
  function advance() {
    stop();
    setPaused(false);
    setHint(false);
    setCursor((n) => (loop && n >= rangeEnd ? rangeStart : n + 1));
    setAuto(true);
  }
  async function play(l: Line, thenAdvance: boolean) {
    const seq = ++playback.current;
    audio.current?.pause();
    setLoading(true);
    setPaused(false);
    try {
      if (!l.audio_id)
        throw new Error('This line needs audio. Record it or prepare its AI voice first.');
      const blob = await audioBlob(l.audio_id);
      if (seq !== playback.current) return;
      const player = audio.current!;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      player.src = objectUrl.current;
      player.playbackRate = speed;
      player.onended = () => {
        setPlaying(false);
        if (thenAdvance) advance();
      };
      await player.play();
      setPlaying(true);
    } catch (e) {
      if (seq === playback.current) {
        setAuto(false);
        ctx.message(
          (e as Error).name === 'NotAllowedError'
            ? 'Tap Play app line to start audio in this browser.'
            : (e as Error).message,
        );
      }
    } finally {
      if (seq === playback.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (ctx.startLine && line?.character_id) {
      ctx.setMyRole(line.character_id);
      const live = new Set(ctx.live);
      live.add(line.character_id);
      ctx.setLive(live);
    }
    ctx.setStartLine(null);
    api<{ lines: Practice[] }>('/groups/' + ctx.group!.id + '/practice')
      .then((r) => setSaved(new Set(r.lines.filter((l) => l.saved).map((l) => l.line_id))))
      .catch(() => {});
    return () => {
      playback.current++;
      audio.current?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  useEffect(() => {
    setHint(false);
    setPaused(false);
    if (auto && line?.character_id && !ctx.live.has(line.character_id)) void play(line, true);
    else {
      stop();
      setAuto(false);
    }
    return () => {
      playback.current++;
      audio.current?.pause();
    };
  }, [cursor, auto, [...ctx.live].sort().join(',')]);
  useEffect(() => {
    const box = reader.current;
    if (!box) return;
    const active = box.querySelector<HTMLElement>('[aria-current="step"]');
    if (active && box.scrollHeight > box.clientHeight)
      box.scrollTop = Math.max(
        0,
        active.offsetTop - (box.clientHeight - Math.min(active.offsetHeight, box.clientHeight)) / 2,
      );
    else box.scrollTop = 0;
  }, [cursor, hide, hint]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);
  function pause() {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      setPaused(true);
    } else if (paused && audio.current?.src) {
      void audio.current
        .play()
        .then(() => {
          setPlaying(true);
          setPaused(false);
        })
        .catch(() => ctx.message('Tap Play app line to resume.'));
    }
  }
  const previousCue = lines.slice(0, cursor).findLast((l) => l.character_id);
  async function repeat() {
    if (!previousCue) return;
    if (isMine) await ctx.recordPractice(line.id, 'repeat');
    await play(previousCue, false);
  }
  async function getHint() {
    if (!hintUsed.current && isMine) {
      await ctx.recordPractice(line.id, 'hint');
      hintUsed.current = true;
    }
    setHint(true);
    ctx.message(line.text.split(/\s+/).slice(0, 5).join(' ') + '…');
  }
  async function bookmark() {
    const marked = new Set(saved);
    const exists = marked.has(line.id);
    await ctx.recordPractice(line.id, exists ? 'unsave' : 'save');
    exists ? marked.delete(line.id) : marked.add(line.id);
    setSaved(marked);
    ctx.message(exists ? 'Removed from saved lines.' : 'Saved to My practice.');
  }
  const roleIds = new Set(lines.map((l) => l.character_id).filter(Boolean));
  const liveCount = [...roleIds].filter((id) => ctx.live.has(id!)).length;
  return (
    <>
      <audio
        ref={audio}
        preload="auto"
        onError={() => {
          setPlaying(false);
          setAuto(false);
          ctx.message('This recording could not play. Try preparing it again.');
        }}
      />
      <div className="rehearsal-header">
        <button
          className="icon-btn"
          aria-label="Back to scene setup"
          onClick={() => ctx.go('scene')}
        >
          <Icon name="back" />
        </button>
        <div className="rehearsal-title">
          <h1>{ctx.script!.script.title}</h1>
          <p>{ctx.scene!.scene.title}</p>
        </div>
        <button
          className="icon-btn"
          aria-label="Record and prepare audio"
          onClick={() => ctx.go('audio')}
        >
          <Icon name="mic" />
        </button>
        <button
          className="icon-btn"
          aria-label="Rehearsal settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="settings" />
        </button>
      </div>
      <div className="rehearsal-grid">
        <section className="script-stage">
          <div className="stage-top">
            <div className="row">
              <Pill kind="wine">
                {liveCount} live · {roleIds.size - liveCount} app
              </Pill>
              <small>{paused ? 'Paused' : 'Reading view'}</small>
            </div>
            <small>
              {Math.min(cursor + 1, lines.length)} / {lines.length} lines
            </small>
          </div>
          {finished ? (
            <div className="session-finished">
              <Icon name="check" />
              <h2>A little stronger, every time.</h2>
              <p>You’ve reached the end of this scene.</p>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    setCursor(loop ? rangeStart : 0);
                    setAuto(false);
                  }}
                >
                  <Icon name="repeat" />
                  Run it again
                </button>
                <button className="btn secondary" onClick={() => ctx.go('progress')}>
                  My practice
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="reader-window"
                ref={reader}
                tabIndex={0}
                role="region"
                aria-label="Script context. Scroll to read long speeches."
              >
                {contextWindow(lines, cursor).map(({ line: l, index }) => {
                  const kind =
                    index === cursor
                      ? 'current'
                      : Math.abs(index - cursor) === 1
                        ? 'adjacent'
                        : 'context';
                  const hidden = hide && !!l.character_id && ctx.live.has(l.character_id);
                  return (
                    <div
                      className={
                        'dialogue-line ' + kind + (l.character_id ? '' : ' direction-line')
                      }
                      key={l.id}
                      aria-current={index === cursor ? 'step' : undefined}
                    >
                      <span className="line-number">{l.position + 1}</span>
                      <div className="speaker">
                        {l.speaker || 'Stage direction'}
                        {index === cursor && l.character_id && (
                          <Pill kind={isLive ? 'wine' : 'gold'}>{isLive ? 'LIVE' : 'APP'}</Pill>
                        )}
                      </div>
                      <p className={hidden && !(index === cursor && hint) ? 'hidden-text' : ''}>
                        {hidden
                          ? index === cursor && hint
                            ? l.text.split(/\s+/).slice(0, 5).join(' ') + '…'
                            : 'Line hidden · recall it in your own time'
                          : l.text}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="rehearsal-controls">
                <p className="cue-status">
                  {loading
                    ? 'Getting the recording…'
                    : paused
                      ? 'Rehearsal paused'
                      : isLive
                        ? 'Your turn · continue when you’re ready'
                        : !line.character_id
                          ? 'Stage direction · continue when you’re ready'
                          : playing
                            ? 'App voice is playing'
                            : 'App voice · tap to play'}
                </p>
                <div className="transport">
                  <button
                    className="icon-btn"
                    disabled={!cursor}
                    aria-label="Previous line"
                    onClick={() => {
                      stop();
                      setAuto(false);
                      setCursor(Math.max(0, cursor - 1));
                    }}
                  >
                    <Icon name="rewind" />
                  </button>
                  <button
                    className="btn"
                    disabled={loading}
                    onClick={() => {
                      if (paused) {
                        pause();
                        return;
                      }
                      if (isLive || !line.character_id || playing) advance();
                      else void play(line, true);
                    }}
                  >
                    <Icon
                      name={paused || (!isLive && !playing && line.character_id) ? 'play' : 'arrow'}
                    />
                    {paused
                      ? 'Resume'
                      : isLive || !line.character_id
                        ? 'Continue'
                        : playing
                          ? 'Next line'
                          : 'Play app line'}
                  </button>
                  <button
                    className="icon-btn"
                    disabled={!playing && !paused}
                    onClick={pause}
                    aria-label={paused ? 'Resume audio' : 'Pause audio'}
                  >
                    <Icon name={paused ? 'play' : 'pause'} />
                  </button>
                </div>
                <div className="secondary-controls">
                  <button
                    className="control-label"
                    disabled={!previousCue || !isLive || loading}
                    onClick={() => ctx.act(repeat)}
                  >
                    <Icon name="repeat" />
                    Repeat cue
                  </button>
                  <button
                    className={'control-label ' + (hide ? 'active' : '')}
                    onClick={() => {
                      setHide(!hide);
                      setHint(false);
                    }}
                  >
                    <Icon name={hide ? 'eyeoff' : 'eye'} />
                    {hide ? 'Show lines' : 'Hide lines'}
                  </button>
                  <button
                    className="control-label"
                    disabled={!isLive}
                    onClick={() => ctx.act(getHint)}
                  >
                    <Icon name="spark" />
                    Hint
                  </button>
                  <button
                    className={'control-label ' + (saved.has(line.id) ? 'active' : '')}
                    onClick={() => ctx.act(bookmark)}
                  >
                    <Icon name="bookmark" />
                    Save line
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        <aside className="rehearsal-aside">
          <section className="panel">
            <div className="panel-header">
              <h2>In this scene</h2>
              <button className="text-link" onClick={() => setSettings(true)}>
                Edit
              </button>
            </div>
            <div className="panel-content">
              <Roles ctx={ctx} interactive={false} />
            </div>
          </section>
          <section className="panel">
            <div className="panel-content">
              <div className="setting-row">
                <span>
                  <b>Loop passage</b>
                  <small>
                    {loop ? `Lines ${rangeStart + 1}–${rangeEnd + 1}` : 'Start again at the end'}
                  </small>
                </span>
                <button
                  className="switch"
                  role="switch"
                  aria-label="Loop passage"
                  aria-checked={loop}
                  onClick={() => setLoop(!loop)}
                />
              </div>
              <div className="setting-row">
                <b>Playback speed</b>
                <select
                  className="settings-select"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[0.75, 0.85, 1, 1.15, 1.25].map((n) => (
                    <option value={n} key={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn secondary full" onClick={() => ctx.go('audio')}>
                <Icon name="mic" />
                Record & AI audio
              </button>
            </div>
          </section>
        </aside>
      </div>
      {settings && (
        <Dialog title="Your rehearsal" close={() => setSettings(false)}>
          <p className="modal-description">
            Choose who performs live. The app plays the missing parts.
          </p>
          <Roles ctx={ctx} />
          <MyRole ctx={ctx} />
          <div className="setting-row">
            <b>Hide live-role lines</b>
            <button
              className="switch"
              role="switch"
              aria-label="Hide live-role lines"
              aria-checked={hide}
              onClick={() => setHide(!hide)}
            />
          </div>
          <div className="setting-row">
            <b>Loop passage</b>
            <button
              className="switch"
              role="switch"
              aria-label="Loop passage"
              aria-checked={loop}
              onClick={() => setLoop(!loop)}
            />
          </div>
          {loop && (
            <div className="loop-range">
              <label className="field">
                From line
                <select
                  className="input"
                  value={rangeStart}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRangeStart(v);
                    setRangeEnd((n) => Math.max(n, v));
                  }}
                >
                  {lines.map((l, i) => (
                    <option value={i} key={l.id}>
                      {l.position + 1} · {l.speaker || 'Stage direction'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Through line
                <select
                  className="input"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(Number(e.target.value))}
                >
                  {lines.map(
                    (l, i) =>
                      i >= rangeStart && (
                        <option value={i} key={l.id}>
                          {l.position + 1} · {l.speaker || 'Stage direction'}
                        </option>
                      ),
                  )}
                </select>
              </label>
            </div>
          )}
          <label className="field">
            Playback speed
            <select
              className="input"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.75, 0.85, 1, 1.15, 1.25].map((n) => (
                <option value={n} key={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn full"
            onClick={() => {
              if (loop && (cursor < rangeStart || cursor > rangeEnd)) {
                stop();
                setCursor(rangeStart);
                setAuto(false);
              }
              setSettings(false);
            }}
          >
            Done
            <Icon name="check" />
          </button>
        </Dialog>
      )}
    </>
  );
}
