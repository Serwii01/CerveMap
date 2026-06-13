/**
 * Geometria para proyectar la sombra REAL de los edificios.
 *
 * Modelo: un edificio es un prisma (footprint + altura h). Con el sol a una
 * elevacion `alpha` y azimut `theta`, su sombra sobre el suelo es la "barrida"
 * del footprint en direccion contraria al sol, una distancia L = h / tan(alpha).
 * Esto equivale a la suma de Minkowski del poligono con ese segmento. Para
 * visualizar y testear usamos la envolvente convexa de
 *   footprint  ∪  footprint desplazado por L en direccion anti-solar,
 * que es una aproximacion honesta (exacta si el footprint es convexo, y casi
 * todos los edificios urbanos lo son a grandes rasgos).
 *
 * Un bar esta "en sombra" si su punto cae dentro de la sombra de algun edificio.
 * Todo el calculo es en metros (proyeccion local equirectangular), suficiente a
 * escala de ciudad y sin dependencias externas.
 */

const DEG = Math.PI / 180;

/** Proyector lat/lng <-> metros locales alrededor de un punto de referencia. */
export function makeProjector(lat0, lng0) {
  const mPerLat = 110540;
  const mPerLng = 111320 * Math.cos(lat0 * DEG);
  return {
    toM: ([lng, lat]) => [(lng - lng0) * mPerLng, (lat - lat0) * mPerLat],
    toLngLat: ([x, y]) => [lng0 + x / mPerLng, lat0 + y / mPerLat],
  };
}

/** Punto dentro de poligono (ray casting). ring: [[x,y], ...] */
export function pointInPolygon([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Envolvente convexa (monotone chain). points: [[x,y], ...] */
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function bbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Construye el poligono de sombra de un edificio.
 * @returns {{ringLngLat, hullM, bboxM}|null} null si el sol esta bajo el horizonte.
 */
export function buildShadow(building, sun, proj, maxLen = 250) {
  if (!sun.isUp || sun.altitudeDeg <= 0.5) return null;
  const h = building.height;
  if (!h || h <= 0) return null;

  const L = Math.min(h / Math.tan(sun.altitudeDeg * DEG), maxLen);
  // Direccion de la sombra: opuesta al sol. azimut compass: 0=N,90=E.
  const sx = -Math.sin(sun.azimuthDeg * DEG) * L; // este
  const sy = -Math.cos(sun.azimuthDeg * DEG) * L; // norte

  const footM = building.ring.map(proj.toM);
  const transM = footM.map(([x, y]) => [x + sx, y + sy]);
  const hullM = convexHull(footM.concat(transM));
  if (hullM.length < 3) return null;

  const ringLngLat = hullM.map(proj.toLngLat);
  ringLngLat.push(ringLngLat[0]); // anillo cerrado (GeoJSON)

  return {
    ringLngLat,
    hullM,
    bboxM: bbox(hullM),
  };
}

/** ¿Esta el punto (lng,lat) dentro de la sombra de algun edificio? */
export function isInAnyShadow(lngLat, shadows, proj) {
  const [px, py] = proj.toM(lngLat);
  for (const s of shadows) {
    const [minX, minY, maxX, maxY] = s.bboxM;
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    if (pointInPolygon([px, py], s.hullM)) return true;
  }
  return false;
}
