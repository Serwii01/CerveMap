/**
 * Carga de bares por TILES (no por municipio entero). Una ciudad grande puede
 * tener un bbox enorme: en lugar de una consulta gigante a Overpass (lenta y
 * truncada), troceamos el área en tiles de ~800 m y cargamos solo los tiles del
 * viewport que aún no estén en memoria. Cada tile tiene un bbox determinista, así
 * que se cachea de forma estable en IndexedDB.
 */

// ~800 m a latitudes de España: 0.007° lat ≈ 780 m, 0.010° lon ≈ 800-850 m.
export const TILE_LAT = 0.007;
export const TILE_LON = 0.010;

// Tope de tiles por disparo para no saturar Overpass al seleccionar una ciudad
// muy grande con el mapa alejado (los demás se cargan al hacer pan/zoom).
export const MAX_TILES_PER_LOAD = 16;

export function tileIdOf(latIdx, lonIdx) {
  return `${latIdx}_${lonIdx}`;
}

function intersect(a, b) {
  if (!b) return a;
  const s = Math.max(a[0], b[0]);
  const w = Math.max(a[1], b[1]);
  const n = Math.min(a[2], b[2]);
  const e = Math.min(a[3], b[3]);
  return n > s && e > w ? [s, w, n, e] : null;
}

/**
 * Tiles nuevos a cargar: intersección (viewport ∩ ciudad) que no estén ya en
 * `loadedTiles`. Devuelve {id, bbox:[s,w,n,e], center:[lng,lat]} ordenados por
 * cercanía al centro del viewport y limitados a MAX_TILES_PER_LOAD.
 * @param {number[]} viewportBbox [s,w,n,e]
 * @param {number[]|null} cityBbox [s,w,n,e] o null (sin recorte)
 * @param {Set<string>} loadedTiles
 */
export function getNewTiles(viewportBbox, cityBbox, loadedTiles) {
  const region = intersect(viewportBbox, cityBbox);
  if (!region) return [];
  const [s, w, n, e] = region;
  const [vcLng, vcLat] = [(viewportBbox[1] + viewportBbox[3]) / 2, (viewportBbox[0] + viewportBbox[2]) / 2];

  const latStart = Math.floor(s / TILE_LAT);
  const latEnd = Math.floor(n / TILE_LAT);
  const lonStart = Math.floor(w / TILE_LON);
  const lonEnd = Math.floor(e / TILE_LON);

  const tiles = [];
  for (let i = latStart; i <= latEnd; i++) {
    for (let j = lonStart; j <= lonEnd; j++) {
      const id = tileIdOf(i, j);
      if (loadedTiles.has(id)) continue;
      const bbox = [i * TILE_LAT, j * TILE_LON, (i + 1) * TILE_LAT, (j + 1) * TILE_LON];
      const center = [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
      const d2 = (center[0] - vcLng) ** 2 + (center[1] - vcLat) ** 2;
      tiles.push({ id, bbox, center, d2 });
    }
  }
  tiles.sort((a, b) => a.d2 - b.d2);
  return tiles.slice(0, MAX_TILES_PER_LOAD);
}

/**
 * Carga tiles con concurrencia limitada (4) y tolerante a fallos (allSettled):
 * un tile que falle no tumba al resto. Devuelve los bares fusionados.
 * @param {Function} fetchTile (tile, signal) => Promise<bar[]>
 */
export async function loadTilesConcurrent(tiles, fetchTile, concurrency = 4, signal) {
  const out = [];
  const failed = [];
  let i = 0;
  const worker = async () => {
    while (i < tiles.length && !signal?.aborted) {
      const tile = tiles[i++];
      try {
        const bars = await fetchTile(tile, signal);
        if (bars) out.push(...bars);
      } catch (e) {
        // tile fallido (no por abort): se devuelve para poder reintentarlo.
        if (e?.name !== 'AbortError') failed.push(tile.id);
      }
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, tiles.length) }, worker);
  await Promise.allSettled(workers);
  return { bars: out, failed };
}
