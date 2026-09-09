import { useState, useEffect, useRef, type ReactNode } from 'react';
import { signOut, type Auth, type User } from 'firebase/auth';
import { api, send, ApiError, base, audioBlob } from './api';
import * as offline from './offline';
import type { Group, GroupData, ScriptData, SceneData, Me, Practice } from './types';
import { Icon } from './icons';
import {
  Library,
  SceneSetup,
  AudioStudio,
  Editor,
  PracticeView,
  GroupView,
  AccountView,
} from './views';
import { Rehearsal } from './rehearsal';
import {
  Dialog,
  NewGroup,
  ImportScript,
  RecordLine,
  VoiceSettings,
  InviteGroup,
  ColorPicker,
  EditLine,
  ConfirmAction,
} from './modals';
export type Context = {
  user: User;
  auth: Auth;
  me: Me;
  group: Group | undefined;
  data: GroupData | null;
  script: ScriptData | null;
  scene: SceneData | null;
  practice: Practice[];
  online: boolean;
  canEdit: boolean;
  page: string;
  live: Set<string>;
  myRole: string;
  setLive: (s: Set<string>) => void;
  setMyRole: (s: string) => void;
  startLine: string | null;
  setStartLine: (s: string | null) => void;
  go: (p: string) => void;
  chooseGroup: (id: string) => void;
  chooseScript: (id: string, page?: string) => void;
  chooseScene: (id: string, page?: string, lineId?: string) => void;
  reload: () => Promise<void>;
  message: (s: string) => void;
  act: (fn: () => Promise<unknown>) => void;
  open: (type: string, data?: any) => void;
  saveOffline: () => Promise<void>;
  recordPractice: (lineId: string, kind: string) => Promise<void>;
  logout: () => Promise<void>;
};
export function App({ user, auth }: { user: User; auth: Auth }) {
  const pref = (key: string) => localStorage.getItem('pocket:' + user.uid + ':' + key) || '';
  const [page, setPage] = useState(location.hash.slice(1).split('/')[0] || 'library');
  const [me, setMe] = useState<Me | null>(null),
    [groupId, setGroupId] = useState(pref('group')),
    [scriptId, setScriptId] = useState(pref('script')),
    [sceneId, setSceneId] = useState(pref('scene'));
  const [data, setData] = useState<GroupData | null>(null),
    [script, setScript] = useState<ScriptData | null>(null),
    [scene, setScene] = useState<SceneData | null>(null),
    [practice, setPractice] = useState<Practice[]>([]);
  const [live, setLive] = useState<Set<string>>(new Set()),
    [myRole, setMyRole] = useState(''),
    [startLine, setStartLine] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [modal, setModal] = useState<{ type: string; data?: any } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function message(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }
  function go(p: string) {
    location.hash = p;
    setPage(p.split('/')[0]);
    window.scrollTo({ top: 0 });
  }
  function fail(e: unknown) {
    message(e instanceof Error ? e.message : 'Please try again.');
    if (e instanceof ApiError && e.status === 401)
      setError('Your session has expired. Sign out and sign in again.');
  }
  function act(fn: () => Promise<unknown>) {
    void fn().catch(fail);
  }
  function chooseGroup(id: string) {
    setGroupId(id);
    setScriptId('');
    setSceneId('');
    setScript(null);
    setScene(null);
    setPractice([]);
    setLive(new Set());
    setMyRole('');
    setData(null);
    setModal(null);
    go(page === 'group' ? 'group' : 'library');
  }
  function chooseScript(id: string, next = 'scene') {
    if (id !== scriptId) {
      setScriptId(id);
      setSceneId('');
      setScene(null);
      setScript(null);
      setMyRole('');
      setLive(new Set());
    }
    go(next);
  }
  function chooseScene(id: string, next = 'scene', lineId?: string) {
    if (id !== sceneId) {
      setSceneId(id);
      setScene(null);
    }
    setStartLine(lineId || null);
    go(next);
  }
  async function reload() {
    const fresh = await api<Me>('/me');
    setMe(fresh);
    if (groupId && fresh.groups.some((g) => g.id === groupId)) {
      const group = await api<GroupData>('/groups/' + groupId);
      setData(group);
      if (scriptId && group.scripts.some((s) => s.id === scriptId)) {
        setScript(await api('/scripts/' + scriptId));
        if (sceneId) setScene(await api('/scenes/' + sceneId));
      } else {
        setScriptId(group.scripts[0]?.id || '');
        setSceneId('');
        setScript(null);
        setScene(null);
      }
      if (page === 'progress')
        setPractice((await api<{ lines: Practice[] }>('/groups/' + groupId + '/practice')).lines);
    }
  }
  useEffect(() => {
    const change = () => {
      setPage(location.hash.slice(1).split('/')[0] || 'library');
      setModal(null);
    };
    window.addEventListener('hashchange', change);
    const net = () => setOnline(navigator.onLine);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
    };
  }, []);
  useEffect(() => {
    let active = true;
    api<Me>('/me')
      .then((m) => {
        if (active) {
          setMe(m);
          if (!m.groups.some((g) => g.id === groupId)) setGroupId(m.groups[0]?.id || '');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [user.uid]);
  useEffect(() => {
    if (!me || !groupId) return;
    let active = true;
    setError('');
    api<GroupData>('/groups/' + groupId)
      .then((d) => {
        if (active) {
          setData(d);
          if (!d.scripts.some((s) => s.id === scriptId)) setScriptId(d.scripts[0]?.id || '');
          localStorage.setItem('pocket:' + user.uid + ':group', groupId);
        }
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setScript(null);
          setScene(null);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [groupId, me?.groups.length]);
  useEffect(() => {
    if (!scriptId || !data?.scripts.some((s) => s.id === scriptId)) return;
    let active = true;
    api<ScriptData>('/scripts/' + scriptId)
      .then((d) => {
        if (active) {
          setScript(d);
          if (!d.scenes.some((s) => s.id === sceneId)) setSceneId(d.scenes[0]?.id || '');
          localStorage.setItem('pocket:' + user.uid + ':script', scriptId);
        }
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [scriptId, data?.scripts.length]);
  useEffect(() => {
    if (!sceneId || !script?.scenes.some((s) => s.id === sceneId)) return;
    let active = true;
    api<SceneData>('/scenes/' + sceneId)
      .then((d) => {
        if (active) {
          setScene(d);
          const first = d.lines.find((l) => l.character_id)?.character_id || '';
          if (!myRole || !script.characters.some((c) => c.id === myRole)) {
            setMyRole(first);
            setLive(new Set(first ? [first] : []));
          }
          localStorage.setItem('pocket:' + user.uid + ':scene', sceneId);
        }
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [sceneId, script?.script.id]);
  useEffect(() => {
    document.body.dataset.page = page;
    document.title =
      'Pocket Partner · ' +
      ({
        library: 'Library',
        audio: 'Record & AI',
        rehearse: 'Rehearsal',
        progress: 'My practice',
        group: 'Groups',
        scene: 'Scene setup',
        editor: 'Script editor',
        account: 'Your account',
        invite: 'Join a group',
      }[page] || 'Library');
    if (page === 'progress' && groupId)
      api<{ lines: Practice[] }>('/groups/' + groupId + '/practice')
        .then((p) => setPractice(p.lines))
        .catch(fail);
  }, [page, groupId]);
  const processing = scene?.jobs.some((j) => ['queued', 'running'].includes(j.status));
  useEffect(() => {
    if (!processing || !sceneId || !online) return;
    const timer = setInterval(
      () =>
        api<SceneData>('/scenes/' + sceneId)
          .then(setScene)
          .catch(fail),
      3000,
    );
    return () => clearInterval(timer);
  }, [processing, sceneId, online]);
  useEffect(() => {
    if (!online) return;
    act(async () => {
      const queue = (await offline.get<any[]>(user.uid, 'practice-queue')) || [];
      for (const event of queue) {
        try {
          await send('/practice', event);
        } catch (e) {
          if (e instanceof ApiError && [403, 404].includes(e.status)) continue;
          throw e;
        }
      }
      await offline.put(user.uid, 'practice-queue', []);
    });
  }, [online]);
  async function recordPractice(lineId: string, kind: string) {
    const event = { eventId: crypto.randomUUID(), lineId, kind };
    if (!navigator.onLine) {
      const queue = (await offline.get<any[]>(user.uid, 'practice-queue')) || [];
      queue.push(event);
      await offline.put(user.uid, 'practice-queue', queue);
      return;
    }
    await send('/practice', event);
  }
  async function saveOffline() {
    if (!scene || !script || !me || !data) return;
    const missing = scene.lines.filter((l) => l.character_id && !l.audio_id).length;
    if (missing)
      throw new Error(
        `Prepare the ${missing} missing audio line${missing === 1 ? '' : 's'} first.`,
      );
    message('Saving this scene for offline rehearsal…');
    for (const line of scene.lines)
      if (line.audio_id)
        await offline.put(user.uid, 'audio:' + line.audio_id, await audioBlob(line.audio_id));
    await offline.put(user.uid, '/me', me);
    await offline.put(user.uid, '/groups/' + groupId, data);
    await offline.put(user.uid, '/scripts/' + scriptId, script);
    await offline.put(user.uid, '/scenes/' + sceneId, scene);
    const saved = (await offline.get<any[]>(user.uid, 'prepared')) || [];
    await offline.put(user.uid, 'prepared', [
      ...saved.filter((s) => s.id !== sceneId),
      {
        id: sceneId,
        title: script.script.title,
        scene: scene.scene.title,
        expires: Date.now() + 24 * 3600000,
      },
    ]);
    message('Scene saved for 24 hours of offline rehearsal on this device.');
  }
  async function logout() {
    await offline.clear(user.uid);
    await signOut(auth);
  }
  if (!me)
    return (
      <div className="boot-message">
        <h1>Pocket Partner</h1>
        <p>{error || 'Opening your rehearsal space…'}</p>
        {error && (
          <button className="btn" onClick={() => act(logout)}>
            Sign out
          </button>
        )}
      </div>
    );
  const group = me.groups.find((g) => g.id === groupId);
  const ctx: Context = {
    user,
    auth,
    me,
    group,
    data,
    script,
    scene,
    practice,
    online,
    canEdit: !!data && data.role !== 'member',
    page,
    live,
    myRole,
    setLive,
    setMyRole,
    startLine,
    setStartLine,
    go,
    chooseGroup,
    chooseScript,
    chooseScene,
    reload,
    message,
    act,
    open: (type, data) => setModal({ type, data }),
    saveOffline,
    recordPractice,
    logout,
  };
  const navs = [
    ['library', 'library', 'Library'],
    ['audio', 'mic', 'Record & AI'],
    ['rehearse', 'play', 'Rehearse'],
    ['progress', 'chart', 'My practice'],
    ['group', 'users', 'Groups'],
  ];
  const active = ['scene', 'editor'].includes(page) ? 'library' : page;
  const brand = (
    <a className="brand" href="#library">
      <img src={base + '/icon.svg'} alt="" />
      <div className="brand-word">
        pocket partner<span>REHEARSE TOGETHER</span>
      </div>
    </a>
  );
  const initials = (me.user.name || me.user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  let body: ReactNode;
  if (page === 'invite')
    body = (
      <Invitation
        ctx={ctx}
        accepted={async (id) => {
          await reload();
          chooseGroup(id);
          go('group');
        }}
      />
    );
  else if (page === 'account') body = <AccountView ctx={ctx} />;
  else if (!group)
    body = (
      <div className="empty welcome-empty">
        <Icon name="users" />
        <h1>Your company starts here.</h1>
        <p>
          Create a private group, then add a play or just one scene.
          <br />
          Already invited? Open the invitation link shared by your cast.
        </p>
        <button className="btn" onClick={() => setModal({ type: 'group' })}>
          <Icon name="plus" />
          Create your first group
        </button>
      </div>
    );
  else if (error)
    body = (
      <div className="empty">
        <h2>This space is unavailable.</h2>
        <p>{error}</p>
        <button
          className="btn"
          onClick={() => {
            setError('');
            act(reload);
          }}
        >
          Try again
        </button>
      </div>
    );
  else if (!data) body = <div className="empty">Opening your group…</div>;
  else if (page === 'library') body = <Library ctx={ctx} />;
  else if (page === 'group') body = <GroupView ctx={ctx} />;
  else if (page === 'progress') body = <PracticeView ctx={ctx} />;
  else if (!scriptId || !data.scripts.length)
    body = (
      <div className="empty">
        <h1>Your first scene is waiting.</h1>
        <p>Add a play or standalone scene to {group.name}.</p>
        {ctx.canEdit && (
          <button className="btn" onClick={() => setModal({ type: 'import' })}>
            <Icon name="plus" />
            Add a script
          </button>
        )}
      </div>
    );
  else if (!script || !scene) body = <div className="empty">Opening your scene…</div>;
  else
    body =
      page === 'audio' ? (
        <AudioStudio ctx={ctx} />
      ) : page === 'rehearse' ? (
        <Rehearsal key={scene.scene.id} ctx={ctx} />
      ) : page === 'editor' ? (
        <Editor ctx={ctx} />
      ) : (
        <SceneSetup ctx={ctx} />
      );
  function close() {
    setModal(null);
  }
  const saved = async () => {
    close();
    await reload();
  };
  return (
    <>
      <aside className="sidebar">
        {brand}
        <button className="workspace" onClick={() => setModal({ type: 'workspace' })}>
          <span className="workspace-icon">
            <Icon name="users" />
          </span>
          <span>
            <b>{group?.name || 'Your groups'}</b>
            <small>Switch or create a group</small>
          </span>
          <Icon name="down" />
        </button>
        <p className="nav-label">YOUR SPACE</p>
        <nav className="side-nav" aria-label="Main navigation">
          {navs.map(([id, i, label]) => (
            <a
              key={id}
              href={'#' + id}
              className={'nav-link ' + (active === id ? 'active' : '')}
              aria-current={active === id ? 'page' : undefined}
            >
              <Icon name={i} />
              {label}
              {id === 'library' && <span className="nav-count">{data?.scripts.length || 0}</span>}
            </a>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-note">
            <small>COURSE PROJECT · MVP</small>
          </div>
          <a className="profile" href="#account">
            <span className="avatar">{initials}</span>
            <span>
              <b>{me.user.name}</b>
              <small>Your account</small>
            </span>
            <Icon name="settings" />
          </a>
        </div>
      </aside>
      <div className="main">
        <header className="mobile-header">
          {brand}
          <button className="mobile-workspace" onClick={() => setModal({ type: 'workspace' })}>
            <span>{group?.name || 'Your groups'}</span>
            <Icon name="down" />
          </button>
        </header>
        <header className="topbar">
          <button className="group-breadcrumb" onClick={() => setModal({ type: 'workspace' })}>
            {group?.name || 'Your groups'}
            <Icon name="down" />
          </button>
          <div className="topbar-right">
            <span className="preview-label">Course project · MVP</span>
            <a href="#account" aria-label="Your account">
              <span className="avatar">{initials}</span>
            </a>
          </div>
        </header>
        {!online && (
          <div className="offline-banner" role="status">
            Offline · prepared scenes stay available for 24 hours.
          </div>
        )}
        <main className={'content ' + (page === 'rehearse' ? 'rehearsal-content' : '')}>
          {body}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Main navigation">
        {navs.map(([id, i, label]) => (
          <a
            key={id}
            href={'#' + id}
            className={active === id ? 'active' : ''}
            aria-current={active === id ? 'page' : undefined}
          >
            <Icon name={i} />
            {label}
          </a>
        ))}
      </nav>
      {toast && (
        <div id="toast" className="show" role="status">
          {toast}
        </div>
      )}
      {modal?.type === 'workspace' && (
        <Dialog title="Your groups" close={close}>
          <p className="modal-description">
            A separate space for each cast. You can belong to more than one group.
          </p>
          <div className="group-options">
            {me.groups.map((g) => (
              <button
                key={g.id}
                className={'choice-card ' + (g.id === groupId ? 'selected' : '')}
                onClick={() => chooseGroup(g.id)}
              >
                <Icon name="users" />
                <span>
                  <b>{g.name}</b>
                  <small>{g.role}</small>
                </span>
                {g.id === groupId && <Icon name="check" />}
              </button>
            ))}
          </div>
          <button className="btn full modal-primary" onClick={() => setModal({ type: 'group' })}>
            <Icon name="plus" />
            Create a group
          </button>
        </Dialog>
      )}
      {modal?.type === 'group' && (
        <NewGroup
          close={close}
          created={async (id) => {
            await reload();
            chooseGroup(id);
            go('group');
          }}
        />
      )}
      {modal?.type === 'import' && group && (
        <ImportScript
          group={group}
          close={close}
          created={async (id) => {
            await reload();
            chooseScript(id);
            close();
          }}
        />
      )}
      {modal?.type === 'record' && <RecordLine line={modal.data} close={close} saved={saved} />}
      {modal?.type === 'voices' && script && (
        <VoiceSettings script={script} close={close} saved={saved} />
      )}
      {modal?.type === 'invite' && group && <InviteGroup group={group} close={close} />}
      {modal?.type === 'color' && (
        <ColorPicker script={modal.data || script?.script} close={close} saved={saved} />
      )}
      {modal?.type === 'edit' && script && (
        <EditLine line={modal.data} characters={script.characters} close={close} saved={saved} />
      )}
      {modal?.type === 'confirm' && <ConfirmAction {...modal.data} close={close} />}
      {modal?.type === 'info' && (
        <Dialog title={modal.data.title} close={close}>
          {modal.data.body}
        </Dialog>
      )}
    </>
  );
}
function Invitation({ ctx, accepted }: { ctx: Context; accepted: (id: string) => Promise<void> }) {
  const [invite, setInvite] = useState<{ name: string; role: string } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const token = location.hash.split('/')[1];
  useEffect(() => {
    api('/invitations/' + encodeURIComponent(token || ''))
      .then(setInvite)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="panel invite-page">
      <Icon name="users" />
      <h1>{invite ? 'Join ' + invite.name : 'Your invitation'}</h1>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !invite ? (
        <p>Checking your invitation…</p>
      ) : (
        <>
          <p>
            You’ve been invited as {invite.role === 'editor' ? 'an editor' : 'a member'}. Joining
            gives you access to the group’s scripts and recordings.
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              send('/invitations/' + token + '/accept')
                .then((r) => accepted(r.groupId))
                .catch((e) => {
                  setError(e.message);
                  setBusy(false);
                });
            }}
          >
            Join group
            <Icon name="arrow" />
          </button>
        </>
      )}
      <button className="text-link" onClick={() => ctx.go('library')}>
        Back to library
      </button>
    </div>
  );
}
