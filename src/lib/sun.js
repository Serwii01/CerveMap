import SunCalc from 'suncalc';

const RAD = 180 / Math.PI;

/**
 * Calcula la posicion del sol para una fecha y coordenadas.
 * SunCalc devuelve el azimut medido desde el SUR en sentido horario.
 * Lo convertimos a azimut de brujula (desde el NORTE, 0-360).
 */
export function getSunPosition(date, lat, lng) {
  const pos = SunCalc.getPosition(date, lat, lng);
  const altitudeDeg = pos.altitude * RAD;
  // Azimut de brujula: 0 = Norte, 90 = Este, 180 = Sur, 270 = Oeste.
  const azimuthDeg = (pos.azimuth * RAD + 180 + 360) % 360;
  return {
    altitudeDeg,
    azimuthDeg,
    isUp: altitudeDeg > 0,
  };
}

/** Horas de salida y puesta del sol para la fecha dada. */
export function getSunTimes(date, lat, lng) {
  const t = SunCalc.getTimes(date, lat, lng);
  return { sunrise: t.sunrise, sunset: t.sunset };
}

/** Convierte un azimut en grados al nombre de punto cardinal mas cercano. */
export function azimuthToCardinal(deg) {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO',
  ];
  const i = Math.round(deg / 22.5) % 16;
  return dirs[i];
}
