import type { User } from 'firebase/auth';
import * as offline from './offline';
export const base = '/pocket-partner';
let user: User | null = null;
export const setUser = (value: User | null) => {
  user = value;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (!user) throw new ApiError(401, 'Please sign in.');
  if (!navigator.onLine && (!options.method || options.method === 'GET')) {
    const cached = await offline.get<T>(user.uid, path);
    if (cached !== undefined) return cached;
    throw new ApiError(
      0,
      'This page is not prepared for offline use. Connect to the internet to open it.',
    );
  }
  let response: Response;
  try {
    const token = await user.getIdToken();
    response = await fetch(base + '/api' + path, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        Authorization: 'Bearer ' + token,
        ...options.headers,
      },
    });
  } catch (e) {
    if (!options.method || options.method === 'GET') {
      const cached = await offline.get<T>(user.uid, path);
      if (cached !== undefined) return cached;
    }
    throw new ApiError(0, 'The connection was interrupted. Please try again.');
  }
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) await offline.clear(user.uid).catch(() => {});
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'This request could not be completed.');
  }
  return await response.json();
}
export const send = <T = any>(path: string, body: unknown = {}, method = 'POST') =>
  api<T>(path, { method, body: JSON.stringify(body) });
export async function audioBlob(id: string) {
  if (!user) throw new Error('Please sign in.');
  const cached = await offline.get<Blob>(user.uid, 'audio:' + id);
  if (!navigator.onLine && cached) return cached;
  const r = await fetch(base + '/api/files/' + id, {
    headers: { Authorization: 'Bearer ' + (await user.getIdToken()) },
  });
  if (!r.ok) throw new ApiError(r.status, 'This recording is not available.');
  return r.blob();
}
export async function downloadOriginal(id: string, title: string) {
  const blob = await audioBlob(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title + (blob.type === 'application/pdf' ? '.pdf' : '.txt');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
