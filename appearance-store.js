import { MAX_BACKGROUND_BYTES, validateBackgroundFile } from './src/lib/appearance-rules.js';

const DATABASE_NAME = 'tab-vault-appearance';
const STORE_NAME = 'backgrounds';
const BACKGROUND_KEY = 'dashboard-background';
export { MAX_BACKGROUND_BYTES, validateBackgroundFile };

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function getCustomBackground() {
  return withStore('readonly', (store) => store.get(BACKGROUND_KEY));
}

export function saveCustomBackground(file) {
  return withStore('readwrite', (store) => store.put(file, BACKGROUND_KEY));
}

export function deleteCustomBackground() {
  return withStore('readwrite', (store) => store.delete(BACKGROUND_KEY));
}
