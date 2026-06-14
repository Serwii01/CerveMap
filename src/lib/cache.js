/**
 * Caché persistente en IndexedDB (vía `idb`) para los datos de Overpass, que es
 * lento e impredecible. Guarda cada entrada con su `savedAt` para poder aplicar
 * un TTL y mostrar "actualizado hace X". Todo en el navegador, sin backend.
 */
import { openDB } from 'idb';

const DB_NAME = 'cervemap';
const STORE = 'overpass';
const VERSION = 1;

// TTLs por tipo de dato.
export const TTL = {
  BARS: 60 * 60 * 1000, // 1 h (carga por viewport, los bares cambian poco)
  BUILDINGS: 72 * 60 * 60 * 1000, // 72 h
};

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/** Devuelve el registro { value, savedAt } o null. Nunca lanza. */
export async function cacheGet(key) {
  try {
    return (await (await db()).get(STORE, key)) ?? null;
  } catch {
    return null;
  }
}

/** Guarda value con marca de tiempo. Nunca lanza. */
export async function cacheSet(key, value) {
  try {
    await (await db()).put(STORE, { value, savedAt: Date.now() }, key);
  } catch {
    /* IndexedDB no disponible (modo privado, etc.): seguimos sin caché. */
  }
}

export async function cacheDelete(key) {
  try {
    await (await db()).delete(STORE, key);
  } catch {
    /* ignore */
  }
}

/** ¿El registro existe y está dentro de su TTL? */
export function isFresh(rec, ttlMs) {
  return !!rec && Date.now() - rec.savedAt < ttlMs;
}
