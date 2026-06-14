/** Utilidades de distancia para el modo "Cerca de mí". */

const R = 6371000; // radio terrestre (m)
const DEG = Math.PI / 180;

/** Distancia haversine en metros entre {lat,lng} a y b. */
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Minutos andando (~80 m/min ≈ 4,8 km/h). */
export function walkMinutes(meters) {
  return Math.max(1, Math.round(meters / 80));
}

export function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

/** Texto combinado para popups y listas: "320 m · 4 min andando". */
export function distanceText(meters) {
  return `${formatDistance(meters)} · ${walkMinutes(meters)} min andando`;
}

// Puntuación de sol/sombra por categoría (1 = mejor para tomar el sol).
const SUN_SCORE = { sol: 1, mixto: 0.5, sombra: 0.15, noche: 0 };

/**
 * Score combinado distancia (40%) + sol (60%). La distancia decae suave con una
 * escala de ~600 m para que lo cercano puntúe alto sin penalizar en exceso.
 */
export function rankScore(meters, category) {
  const distScore = Math.exp(-meters / 600);
  const sunScore = SUN_SCORE[category] ?? 0;
  return 0.4 * distScore + 0.6 * sunScore;
}
