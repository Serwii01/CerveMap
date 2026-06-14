import { useEffect, useRef, useState } from 'react';
import { searchCities, reverseGeocode } from '../lib/nominatim.js';
import { SEVILLA_CITY } from '../lib/city.js';

/**
 * Pantalla de inicio: buscador de ciudad (Nominatim, debounce 300 ms),
 * geolocalización con reverse geocoding y Sevilla por defecto.
 * onSelect(city, userLoc?) arranca la app.
 */
export default function WelcomeScreen({ onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState('');
  const ctrlRef = useRef(null);
  const debRef = useRef(0);

  // Búsqueda con debounce de 300 ms y una sola petición activa.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setSearching(true);
      searchCities(term, ctrl.signal)
        .then((r) => {
          setResults(r);
          setSearching(false);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') {
            setResults([]);
            setSearching(false);
          }
        });
    }, 300);
    return () => clearTimeout(debRef.current);
  }, [q]);

  const pick = (r) =>
    onSelect({ name: r.name, lat: r.lat, lon: r.lon, bbox: r.bbox });

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setMsg('Geolocalización no disponible en este navegador.');
      return;
    }
    setMsg('Localizando…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const userLoc = { lat, lng: lon, accuracy: pos.coords.accuracy };
        try {
          const place = await reverseGeocode(lat, lon);
          onSelect(
            { name: place?.name || 'Mi zona', lat, lon, bbox: place?.bbox || null },
            userLoc,
          );
        } catch {
          onSelect({ name: 'Mi zona', lat, lon, bbox: null }, userLoc);
        }
      },
      () => setMsg('No se pudo obtener tu ubicación. Revisa los permisos.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="welcome-title">CerveMap 🍺</h1>
        <p className="welcome-sub">
          Elige tu ciudad y encuentra el bar con más sol —o más sombra— para tu
          cerveza.
        </p>

        <div className="welcome-search">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca tu ciudad…"
            aria-label="Buscar ciudad"
            autoFocus
          />
          {searching && <span className="welcome-spin" aria-hidden="true" />}
          {results.length > 0 && (
            <ul className="welcome-results">
              {results.map((r, i) => (
                <li key={`${r.lat}-${r.lon}-${i}`}>
                  <button type="button" onClick={() => pick(r)}>
                    <span className="welcome-result-name">
                      {r.name}
                      {r.type && <span className="muted"> · {r.type}</span>}
                    </span>
                    <span className="welcome-result-label">{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="welcome-actions">
          <button type="button" className="welcome-geo" onClick={useMyLocation}>
            Usar mi ubicación 📍
          </button>
          <button
            type="button"
            className="welcome-default"
            onClick={() => onSelect(SEVILLA_CITY)}
          >
            Sevilla
          </button>
        </div>

        {msg && <p className="welcome-msg muted">{msg}</p>}
      </div>
    </div>
  );
}
