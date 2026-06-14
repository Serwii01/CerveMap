/**
 * Cliente de Nominatim (OpenStreetMap) para buscar ciudades y geocodificación
 * inversa. Sin API key.
 *
 * Nota sobre el User-Agent: la política de Nominatim pide identificar la app,
 * pero los navegadores NO permiten fijar la cabecera `User-Agent` desde `fetch`
 * (está en la lista de cabeceras prohibidas y se ignora silenciosamente). En su
 * lugar el navegador envía el `Referer` automáticamente, que es lo que Nominatim
 * usa para apps web. Respetamos el rate limit (1 req/s) con debounce de 300 ms y
 * una sola petición activa a la vez (AbortController en el llamador).
 */
const BASE = 'https://nominatim.openstreetmap.org';

function toPlace(r) {
  if (!r) return null;
  const a = r.address || {};
  const name =
    a.city || a.town || a.village || a.municipality || a.county || r.name ||
    (r.display_name ? r.display_name.split(',')[0] : 'Lugar');
  // Nominatim boundingbox: [minlat, maxlat, minlon, maxlon] (strings).
  const bb = (r.boundingbox || []).map(Number);
  return {
    name,
    label: r.display_name || name,
    type: r.addresstype || r.type || '',
    lat: Number(r.lat),
    lon: Number(r.lon),
    bbox: bb.length === 4 && bb.every(Number.isFinite) ? bb : null,
  };
}

/** Busca hasta 5 lugares en España que coincidan con `q`. */
export async function searchCities(q, signal) {
  const params = new URLSearchParams({
    q,
    countrycodes: 'es',
    limit: '5',
    format: 'json',
    addressdetails: '1',
    'accept-language': 'es',
  });
  const res = await fetch(`${BASE}/search?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.map(toPlace).filter(Boolean);
}

/** Geocodificación inversa: de coordenadas a ciudad. */
export async function reverseGeocode(lat, lon, signal) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'json',
    zoom: '12',
    addressdetails: '1',
    'accept-language': 'es',
  });
  const res = await fetch(`${BASE}/reverse?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return toPlace(await res.json());
}
