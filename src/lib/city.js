/**
 * Modelo de "ciudad" seleccionada y persistencia en localStorage.
 * Una ciudad es { name, lat, lon, bbox } donde bbox sigue el orden de Nominatim:
 * [minlat, maxlat, minlon, maxlon].
 */
import { SEVILLA } from './overpass.js';

const KEY = 'cervemap-city';

// Sevilla por defecto (para no romper el flujo actual).
export const SEVILLA_CITY = {
  name: 'Sevilla',
  lat: SEVILLA.center[0],
  lon: SEVILLA.center[1],
  // SEVILLA.bbox es [s, w, n, e] -> [minlat, maxlat, minlon, maxlon].
  bbox: [SEVILLA.bbox[0], SEVILLA.bbox[2], SEVILLA.bbox[1], SEVILLA.bbox[3]],
};

/** bbox Nominatim -> límites MapLibre [[oeste,sur],[este,norte]] para fitBounds. */
export function cityBounds(city) {
  if (!city?.bbox) return null;
  const [minlat, maxlat, minlon, maxlon] = city.bbox;
  return [
    [minlon, minlat],
    [maxlon, maxlat],
  ];
}

export function loadSavedCity() {
  try {
    const raw = localStorage.getItem(KEY);
    const c = raw ? JSON.parse(raw) : null;
    return c && Number.isFinite(c.lat) && Number.isFinite(c.lon) ? c : null;
  } catch {
    return null;
  }
}

export function saveCity(city) {
  try {
    localStorage.setItem(KEY, JSON.stringify(city));
  } catch {
    /* ignore */
  }
}
