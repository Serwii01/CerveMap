/**
 * Utilidades de viewport para la carga lazy de bares por área visible.
 * Convención de bbox: [s, w, n, e] (sur, oeste, norte, este), como Overpass.
 */

/** bbox [s,w,n,e] del área visible del mapa, ampliado un `margin` (20% por defecto). */
export function getViewportBbox(map, margin = 0.2) {
  const b = map.getBounds();
  const s = b.getSouth();
  const w = b.getWest();
  const n = b.getNorth();
  const e = b.getEast();
  const dLat = (n - s) * margin;
  const dLng = (e - w) * margin;
  return [s - dLat, w - dLng, n + dLat, e + dLng];
}

/** Amplía un bbox [s,w,n,e] un `margin` (20% por defecto) por cada lado. */
export function expandBbox([s, w, n, e], margin = 0.2) {
  const dLat = (n - s) * margin;
  const dLng = (e - w) * margin;
  return [s - dLat, w - dLng, n + dLat, e + dLng];
}

function area([s, w, n, e]) {
  return Math.max(0, n - s) * Math.max(0, e - w);
}

function intersection(a, b) {
  const s = Math.max(a[0], b[0]);
  const w = Math.max(a[1], b[1]);
  const n = Math.min(a[2], b[2]);
  const e = Math.min(a[3], b[3]);
  return n > s && e > w ? [s, w, n, e] : null;
}

/**
 * Fracción del nuevo viewport que NO estaba cubierta por el bbox cargado antes.
 * Se compara contra la última carga (la dominante); 1 si no había carga previa.
 */
export function newAreaFraction(bbox, prevBbox) {
  if (!prevBbox) return 1;
  const total = area(bbox);
  if (total === 0) return 0;
  const inter = intersection(bbox, prevBbox);
  const covered = inter ? area(inter) : 0;
  return 1 - Math.min(1, covered / total);
}

/** Centro [lng, lat] de un bbox [s,w,n,e]. */
export function bboxCenter([s, w, n, e]) {
  return [(w + e) / 2, (s + n) / 2];
}
