import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  type Auth,
} from 'firebase/auth';
import { Icon } from './icons';
import { base } from './api';
export const authMessage = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return code === 'auth/weak-password'
    ? 'Use at least 8 characters for your password.'
    : code === 'auth/email-already-in-use'
      ? 'An account with that email already exists. Sign in or reset your password.'
      : code === 'auth/too-many-requests'
        ? 'Too many attempts. Please wait a moment before trying again.'
        : code === 'auth/network-request-failed'
          ? 'Connect to the internet to sign in.'
          : 'Check your email and password, then try again.';
};
export function Login({ auth }: { auth: Auth }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const email = String(data.get('email'));
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        setNotice('If an account exists, a password-reset email is on its way.');
      } else if (mode === 'register') {
        const result = await createUserWithEmailAndPassword(
          auth,
          email,
          String(data.get('password')),
        );
        await updateProfile(result.user, { displayName: String(data.get('name')) });
      } else await signInWithEmailAndPassword(auth, email, String(data.get('password')));
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-art">
        <div className="brand">
          <img src={base + '/icon.svg'} alt="" />
          <span>pocket partner</span>
        </div>
        <div>
          <h1>
            Your scene.
            <br />
            Your pace.
            <br />
            <i>Your partner.</i>
          </h1>
          <p>Learn your lines with your cast, even when a part is missing.</p>
        </div>
        <small>A GROUP EXERCISE · AI PRODUCT MANAGEMENT</small>
      </section>
      <main className="login-form">
        <div className="login-inner">
          <div className="login-logo-mobile">
            <img src={base + '/icon.svg'} alt="Pocket Partner" />
          </div>
          <h1>
            {mode === 'register'
              ? 'Your next act.'
              : mode === 'reset'
                ? 'Find your way back.'
                : 'Welcome back.'}
          </h1>
          <p>
            {location.hash.startsWith('#invite/')
              ? 'Sign in or create an account to accept your group invitation.'
              : mode === 'register'
                ? 'Create a space for your rehearsals.'
                : mode === 'reset'
                  ? 'We’ll send a link to reset your password.'
                  : 'Your next rehearsal is waiting.'}
          </p>
          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input
                  id="name"
                  name="name"
                  className="input"
                  required
                  maxLength={60}
                  autoComplete="name"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                className="input"
                required
                autoComplete="email"
              />
            </div>
            {mode !== 'reset' && (
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="input"
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                {mode === 'register' && <small className="input-hint">At least 8 characters</small>}
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <button className="btn full" disabled={busy}>
              {busy
                ? 'One moment…'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'reset'
                    ? 'Send reset link'
                    : 'Sign in'}
              <Icon name="arrow" />
            </button>
          </form>
          <div className="login-links">
            {mode === 'login' ? (
              <>
                <button
                  className="text-link"
                  onClick={() => {
                    setMode('reset');
                    setError('');
                  }}
                >
                  Forgot password?
                </button>
                <button
                  className="text-link"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <button
                className="text-link"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setNotice('');
                }}
              >
                Back to sign in
              </button>
            )}
          </div>
          <p className="login-foot">Your scripts and recordings stay in your private groups.</p>
        </div>
      </main>
    </div>
  );
}
