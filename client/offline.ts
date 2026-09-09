const DB = 'pocket-partner-private';
const TTL = 24 * 3600000;
type Row = { key: string; uid: string; value: unknown; expires: number };
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const store = r.result.createObjectStore('entries', { keyPath: 'key' });
      store.createIndex('uid', 'uid');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function put(uid: string, key: string, value: unknown) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({
        key: uid + ':' + key,
        uid,
        value,
        expires: Date.now() + TTL,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function get<T>(uid: string, key: string): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db
        .transaction('entries')
        .objectStore('entries')
        .get(uid + ':' + key);
      r.onsuccess = () => {
        const row = r.result as Row | undefined;
        resolve(row && row.expires > Date.now() ? (row.value as T) : undefined);
      };
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function clear(uid: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      const r = store.index('uid').openCursor(IDBKeyRange.only(uid));
      r.onsuccess = () => {
        const cursor = r.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
