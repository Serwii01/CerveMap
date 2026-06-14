/**
 * Evalúa el horario de apertura (`opening_hours` de OSM) en el momento
 * seleccionado, usando la librería `opening_hours`. Todo en cliente.
 *
 * Estados: 'open' | 'closed' | 'unknown' (sin dato o expresión no parseable).
 */
import OpeningHours from 'opening_hours';

// Contexto para reglas que dependen de festivos/ubicación (Andalucía, España).
const NOMINATIM = {
  lat: 37.389,
  lon: -5.984,
  address: { country_code: 'es', state: 'Andalucía' },
};

// Cachea instancias por expresión (parsear es lo caro, y se repiten mucho).
const parsed = new Map();

function getOh(value) {
  if (parsed.has(value)) return parsed.get(value);
  let oh = null;
  try {
    oh = new OpeningHours(value, NOMINATIM);
  } catch {
    oh = null; // expresión inválida en OSM
  }
  parsed.set(value, oh);
  return oh;
}

/** @returns {'open'|'closed'|'unknown'} */
export function openState(value, date) {
  if (!value) return 'unknown';
  const oh = getOh(value);
  if (!oh) return 'unknown';
  try {
    return oh.getState(date) ? 'open' : 'closed';
  } catch {
    return 'unknown';
  }
}

/** Texto legible para el popup. */
export function openLabel(state) {
  if (state === 'open') return '🟢 Abierto ahora';
  if (state === 'closed') return '🔴 Cerrado ahora';
  return '⚪ Horario sin datos';
}
