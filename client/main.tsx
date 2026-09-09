import React from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { App } from './App';
import { Login } from './auth-ui';
import { setUser, base } from './api';
import './styles.css';
import './product.css';
async function boot() {
  let cfg;
  try {
    const r = await fetch(base + '/api/config');
    if (!r.ok) throw new Error();
    cfg = await r.json();
    localStorage.setItem('pocket:firebase-config', JSON.stringify(cfg));
  } catch {
    const saved = localStorage.getItem('pocket:firebase-config');
    if (saved) cfg = JSON.parse(saved);
    else throw new Error('Pocket Partner could not connect. Please reload when you’re online.');
  }
  const auth = initializeAuth(initializeApp(cfg.firebase), {
    persistence: indexedDBLocalPersistence,
  });
  function Root() {
    const [user, setAuthUser] = React.useState<User | null | undefined>();
    React.useEffect(
      () =>
        onAuthStateChanged(auth, (u) => {
          setUser(u);
          setAuthUser(u);
        }),
      [],
    );
    if (user === undefined)
      return <div className="boot-message">Opening your rehearsal space…</div>;
    return user ? <App auth={auth} user={user} /> : <Login auth={auth} />;
  }
  createRoot(document.getElementById('root')!).render(<Root />);
  if ('serviceWorker' in navigator && import.meta.env.PROD)
    navigator.serviceWorker.register(base + '/sw.js', { scope: base + '/' }).catch(() => {});
}
boot().catch((e) => {
  document.getElementById('root')!.textContent = e.message;
});
