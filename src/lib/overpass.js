// Consulta a Overpass API (OpenStreetMap) para obtener bares/pubs.
// Sin API key. Usamos varios endpoints como fallback por si uno falla.

import { loadHeights, lookupHeight } from './heights.js';
import { cacheGet, cacheSet, isFresh, TTL } from './cache.js';

const barsKey = (bbox) => `bars_${bbox.map((v) => v.toFixed(3)).join('_')}`;
const buildingsKey = (bbox) => `buildings_${bbox.map((v) => v.toFixed(3)).join('_')}`;
let lastBarsSavedAt = null;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Bounding box de Sevilla municipio: S, O, N, E.
// Ampliado para cubrir todos los barrios (Sevilla Este, Bellavista, Macarena,
// Triana/Los Remedios, San Jeronimo...) que antes quedaban recortados.
export const SEVILLA = {
  center: [37.3891, -5.9845],
  bbox: [37.30, -6.06, 37.46, -5.88],
};

function buildBarsQuery(bbox) {
  const [s, w, n, e] = bbox;
  // `nwr` = nodes + ways + relations en una sola sentencia (incluye locales
  // mapeados como polígono o relación, no solo como punto). `out body center qt`
  // da el centroide de ways/relations y ordena por proximidad, sin límite fijo.
  return `
    [out:json][timeout:30];
    (
      nwr["amenity"~"^(bar|pub|cafe|restaurant|beer_garden|biergarten|tavern)$"]["name"](${s},${w},${n},${e});
    );
    out body center qt;`;
}

/**
 * Lanza la consulta a TODOS los endpoints a la vez y usa el primero que
 * responde (Promise.any). Cancela los perdedores. Asi la latencia es la del
 * servidor mas rapido en cada momento, no la suma de timeouts en serie.
 */
async function overpassRace(query, signal) {
  const body = 'data=' + encodeURIComponent(query);
  const ctrls = ENDPOINTS.map(() => new AbortController());
  const abortAll = () => ctrls.forEach((c) => c.abort());

  if (signal) {
    if (signal.aborted) abortAll();
    else signal.addEventListener('abort', abortAll, { once: true });
  }

  const one = async (url, ctrl) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  try {
    const data = await Promise.any(ENDPOINTS.map((url, i) => one(url, ctrls[i])));
    abortAll(); // cancela las peticiones perdedoras
    return data;
  } catch (err) {
    if (signal?.aborted) {
      const e = new Error('Aborted');
      e.name = 'AbortError';
      throw e;
    }
    throw new Error('No se pudo conectar con Overpass.');
  }
}

function normalize(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const tags = el.tags || {};
  return {
    id: `${el.type}/${el.id}`,
    lat,
    lng,
    name: tags.name || 'Bar sin nombre',
    amenity: tags.amenity,
    outdoorSeating: tags.outdoor_seating, // 'yes' | 'no' | undefined
    terrace: tags.terrace, // 'yes' | 'no' | undefined
    openingHours: tags.opening_hours, // expresión OSM (puede faltar)
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    address: [tags['addr:street'], tags['addr:housenumber']]
      .filter(Boolean)
      .join(' '),
  };
}

/** ¿El bar tiene terraza exterior confirmada en OSM? */
export function hasTerrace(bar) {
  return bar.outdoorSeating === 'yes' || bar.terrace === 'yes';
}

function buildBuildingsQuery(bbox) {
  const [s, w, n, e] = bbox;
  // Solo edificios con geometria; pedimos altura y plantas si existen.
  return `
    [out:json][timeout:30];
    ( way["building"](${s},${w},${n},${e}); );
    out geom;`;
}

/**
 * Altura declarada en OSM (height / building:levels), o null si no consta.
 * Devuelve la fuente para poder priorizar luego el Catastro.
 */
function osmHeight(tags) {
  if (tags.height) {
    const h = parseFloat(String(tags.height).replace(',', '.'));
    if (!Number.isNaN(h) && h > 0) return h;
  }
  const levels = parseFloat(tags['building:levels']);
  if (!Number.isNaN(levels) && levels > 0) return levels * 3;
  return null;
}

/** Centroide aproximado (media de vértices) de un anillo [[lng,lat],...]. */
function centroidOf(ring) {
  let sx = 0, sy = 0;
  for (const [lng, lat] of ring) {
    sx += lng;
    sy += lat;
  }
  return [sx / ring.length, sy / ring.length];
}

/**
 * Edificios dentro del bbox con su footprint (lng/lat) y altura estimada.
 * Prioridad de altura: OSM > Catastro (lookup por coordenada) > 9 m por defecto.
 * Cada edificio lleva `heightSource`: 'osm' | 'catastro' | 'fallback'.
 * `limit` acota el numero para no saturar el calculo de sombras.
 */
export async function fetchBuildings(bbox, signal, { limit = 4000, force = false } = {}) {
  const key = buildingsKey(bbox);
  if (!force) {
    const rec = await cacheGet(key);
    if (isFresh(rec, TTL.BUILDINGS)) return rec.value;
  }
  // Lanzamos la consulta y la carga del índice del Catastro en paralelo.
  const [data] = await Promise.all([
    overpassRace(buildBuildingsQuery(bbox), signal),
    loadHeights(),
  ]);
  const out = [];
  for (const el of data.elements || []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
    const ring = el.geometry.map((g) => [g.lon, g.lat]);

    let height = osmHeight(el.tags || {});
    let heightSource = 'osm';
    if (height == null) {
      const [lng, lat] = centroidOf(ring);
      const cat = lookupHeight(lat, lng);
      if (cat != null) {
        height = cat;
        heightSource = 'catastro';
      } else {
        height = 9; // 3 plantas, típico del centro de Sevilla
        heightSource = 'fallback';
      }
    }

    out.push({
      id: `way/${el.id}`,
      ring,
      height,
      heightSource,
      assumed: heightSource === 'fallback',
    });
    if (out.length >= limit) break;
  }
  await cacheSet(key, out);
  return out;
}

/**
 * Bares dentro de un bbox [s,w,n,e] del viewport. Caché por bbox con TTL de 1 h.
 * `force` omite el caché (botón Recargar).
 */
export async function fetchBarsInBbox(bbox, signal, { force = false } = {}) {
  const key = barsKey(bbox);
  if (!force) {
    const rec = await cacheGet(key);
    if (isFresh(rec, TTL.BARS)) {
      lastBarsSavedAt = rec.savedAt;
      return rec.value;
    }
  }
  const data = await overpassRace(buildBarsQuery(bbox), signal);
  const seen = new Set();
  const bars = [];
  for (const el of data.elements || []) {
    const b = normalize(el);
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    bars.push(b);
  }
  await cacheSet(key, bars);
  lastBarsSavedAt = Date.now();
  return bars;
}

/** Marca de tiempo de la última carga de bares (para "actualizado hace X"). */
export function barsCacheInfo() {
  return lastBarsSavedAt ? { savedAt: lastBarsSavedAt } : null;
}
