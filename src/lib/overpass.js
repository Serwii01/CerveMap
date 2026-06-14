// Consulta a Overpass API (OpenStreetMap) para obtener bares/pubs.
// Sin API key. Usamos varios endpoints como fallback por si uno falla.

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

function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  // Bares, pubs y biergarten con nombre dentro del bbox.
  return `
    [out:json][timeout:25];
    (
      node["amenity"~"^(bar|pub|biergarten)$"](${s},${w},${n},${e});
      way["amenity"~"^(bar|pub|biergarten)$"](${s},${w},${n},${e});
    );
    out center tags;`;
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
    address: [tags['addr:street'], tags['addr:housenumber']]
      .filter(Boolean)
      .join(' '),
  };
}

function buildBuildingsQuery(bbox) {
  const [s, w, n, e] = bbox;
  // Solo edificios con geometria; pedimos altura y plantas si existen.
  return `
    [out:json][timeout:30];
    ( way["building"](${s},${w},${n},${e}); );
    out geom;`;
}

/** Parsea altura en metros desde tags de OSM (height / building:levels). */
function parseHeight(tags) {
  if (tags.height) {
    const h = parseFloat(String(tags.height).replace(',', '.'));
    if (!Number.isNaN(h) && h > 0) return { height: h, assumed: false };
  }
  const levels = parseFloat(tags['building:levels']);
  if (!Number.isNaN(levels) && levels > 0) {
    return { height: levels * 3, assumed: false };
  }
  // Sin datos: asumimos 3 plantas (~9 m), tipico del centro de Sevilla.
  return { height: 9, assumed: true };
}

/**
 * Edificios dentro del bbox con su footprint (lng/lat) y altura estimada.
 * `limit` acota el numero para no saturar el calculo de sombras.
 */
export async function fetchBuildings(bbox, signal, limit = 4000) {
  const data = await overpassRace(buildBuildingsQuery(bbox), signal);
  const out = [];
  for (const el of data.elements || []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
    const ring = el.geometry.map((g) => [g.lon, g.lat]);
    const { height, assumed } = parseHeight(el.tags || {});
    out.push({ id: `way/${el.id}`, ring, height, assumed });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchBars(bbox = SEVILLA.bbox, signal) {
  const data = await overpassRace(buildQuery(bbox), signal);
  const seen = new Set();
  const bars = [];
  for (const el of data.elements || []) {
    const b = normalize(el);
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    bars.push(b);
  }
  return bars;
}
