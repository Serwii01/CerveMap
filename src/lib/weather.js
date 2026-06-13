// Open-Meteo: temperatura, nubosidad y estado del cielo. Sin API key.

const WMO = {
  0: 'Despejado',
  1: 'Mayormente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla con escarcha',
  51: 'Llovizna ligera',
  53: 'Llovizna',
  55: 'Llovizna intensa',
  61: 'Lluvia ligera',
  63: 'Lluvia',
  65: 'Lluvia intensa',
  71: 'Nieve ligera',
  73: 'Nieve',
  75: 'Nieve intensa',
  80: 'Chubascos ligeros',
  81: 'Chubascos',
  82: 'Chubascos fuertes',
  95: 'Tormenta',
  96: 'Tormenta con granizo',
  99: 'Tormenta fuerte con granizo',
};

export function weatherText(code) {
  return WMO[code] ?? 'Desconocido';
}

export function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 65) return '🌧️';
  if (code <= 75) return '❄️';
  if (code <= 82) return '🌦️';
  return '⛈️';
}

/**
 * Devuelve la meteo horaria de los proximos dias para poder consultar
 * cualquier hora seleccionada. Cacheamos en memoria por sesion.
 */
let cache = null;

export async function fetchWeather(lat, lng, signal) {
  if (cache) return cache;
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    hourly: 'temperature_2m,cloud_cover,weather_code',
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
    forecast_days: '3',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache = data;
  return data;
}

/** Busca la franja horaria mas cercana a `date` en los datos horarios. */
export function weatherAt(data, date) {
  if (!data?.hourly?.time?.length) return null;
  const target = date.getTime();
  const times = data.hourly.time;
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo entrega horas locales sin zona; las interpretamos como locales.
    const diff = Math.abs(new Date(times[i]).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return {
    temperature: data.hourly.temperature_2m?.[bestIdx],
    cloudCover: data.hourly.cloud_cover?.[bestIdx],
    code: data.hourly.weather_code?.[bestIdx],
    time: times[bestIdx],
  };
}
