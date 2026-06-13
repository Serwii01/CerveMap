// Consulta a Overpass API (OpenStreetMap) para obtener bares/pubs.
// Sin API key. Usamos varios endpoints como fallback por si uno falla.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Bounding box aproximado de Sevilla ciudad: S, O, N, E
export const SEVILLA = {
  center: [37.3891, -5.9845],
  bbox: [37.32, -6.04, 37.45, -5.92],
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
  const body = 'data=' + encodeURIComponent(buildBuildingsQuery(bbox));
  let lastError;

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const out = [];
      for (const el of data.elements || []) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
        const ring = el.geometry.map((g) => [g.lon, g.lat]);
        const { height, assumed } = parseHeight(el.tags || {});
        out.push({ id: `way/${el.id}`, ring, height, assumed });
        if (out.length >= limit) break;
      }
      return out;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
    }
  }
  throw lastError || new Error('No se pudieron cargar los edificios.');
}

export async function fetchBars(bbox = SEVILLA.bbox, signal) {
  const body = 'data=' + encodeURIComponent(buildQuery(bbox));
  let lastError;

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const bars = (data.elements || [])
        .map(normalize)
        .filter(Boolean)
        // Evita duplicados por id.
        .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i);
      return bars;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
      // Probar siguiente endpoint.
    }
  }
  throw lastError || new Error('No se pudo conectar con Overpass.');
}
