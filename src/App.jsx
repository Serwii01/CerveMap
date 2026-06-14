import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import TimeControls from './components/TimeControls.jsx';
import SunCompass from './components/SunCompass.jsx';
import { fetchBars, fetchBuildings, SEVILLA } from './lib/overpass.js';
import {
  fetchWeather,
  weatherAt,
  weatherText,
  weatherEmoji,
} from './lib/weather.js';
import { getSunPosition, getSunTimes } from './lib/sun.js';
import { classifyBar, classifyByShadow, CATEGORY_META, CATEGORY } from './lib/classify.js';
import {
  makeProjector,
  prepareBuilding,
  buildShadow,
  buildShadowIndex,
  isInAnyShadowIndexed,
} from './lib/geometry.js';

const [LAT, LNG] = SEVILLA.center;
const MIN_ZOOM_3D = 15;

const inBbox = ([lng, lat], [s, w, n, e]) =>
  lat >= s && lat <= n && lng >= w && lng <= e;

export default function App() {
  const [date, setDate] = useState(() => new Date());
  const [bars, setBars] = useState([]);
  const [barsState, setBarsState] = useState('loading');
  const [weather, setWeather] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const [mode3d, setMode3d] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem('cervemap-theme') || 'light',
  );
  const [buildings, setBuildings] = useState([]);
  const [buildingsBbox, setBuildingsBbox] = useState(null);
  const [buildingsState, setBuildingsState] = useState('idle'); // idle|loading|ok|error
  const [view, setView] = useState(null); // {bbox, zoom}
  const lastFetchKey = useRef(null);

  // Aplica el tema al documento y lo persiste.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cervemap-theme', theme);
  }, [theme]);

  const proj = useMemo(() => makeProjector(LAT, LNG), []);
  const sun = useMemo(() => getSunPosition(date, LAT, LNG), [date]);
  const sunTimes = useMemo(() => getSunTimes(date, LAT, LNG), [date]);

  // --- Carga de bares ---
  useEffect(() => {
    const ctrl = new AbortController();
    setBarsState('loading');
    fetchBars(SEVILLA.bbox, ctrl.signal)
      .then((d) => {
        setBars(d);
        setBarsState('ok');
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setBarsState('error');
      });
    return () => ctrl.abort();
  }, []);

  // --- Carga de meteo ---
  useEffect(() => {
    const ctrl = new AbortController();
    fetchWeather(LAT, LNG, ctrl.signal).then(setWeather).catch(() => {});
    return () => ctrl.abort();
  }, []);

  // --- Carga de edificios cuando hace falta (modo 3D + zoom suficiente) ---
  useEffect(() => {
    if (!mode3d || !view || view.zoom < MIN_ZOOM_3D) return;
    // Clave por bbox redondeado para no repetir la misma consulta.
    const key = view.bbox.map((v) => v.toFixed(3)).join(',');
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    const ctrl = new AbortController();
    setBuildingsState('loading');
    fetchBuildings(view.bbox, ctrl.signal)
      .then((d) => {
        setBuildings(d);
        setBuildingsBbox(view.bbox);
        setBuildingsState('ok');
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setBuildingsState('error');
      });
    return () => ctrl.abort();
  }, [mode3d, view]);

  // Precomputo independiente del sol (proyeccion + envolvente): solo al cargar.
  const preparedBuildings = useMemo(
    () => buildings.map((b) => prepareBuilding(b, proj)),
    [buildings, proj],
  );

  // --- Sombras reales (geometria) ---
  const shadows = useMemo(() => {
    if (!mode3d || !sun.isUp || !preparedBuildings.length) return [];
    const out = [];
    for (const b of preparedBuildings) {
      const s = buildShadow(b, sun, proj);
      if (s) out.push(s);
    }
    return out;
  }, [mode3d, sun, preparedBuildings, proj]);

  // Indice espacial para el test bar-en-sombra.
  const shadowIndex = useMemo(() => buildShadowIndex(shadows), [shadows]);

  const shadowsActive = mode3d && sun.isUp && buildings.length > 0;
  const assumedCount = useMemo(
    () => (shadowsActive ? buildings.filter((b) => b.assumed).length : 0),
    [shadowsActive, buildings],
  );

  // --- Evaluacion de cada bar ---
  const evaluated = useMemo(
    () =>
      bars.map((bar) => {
        const useShadow =
          shadowsActive && buildingsBbox && inBbox([bar.lng, bar.lat], buildingsBbox);
        const ev = useShadow
          ? classifyByShadow(sun, isInAnyShadowIndexed([bar.lng, bar.lat], shadowIndex, proj))
          : classifyBar(sun, bar);
        return { bar, ev, real: useShadow };
      }),
    [bars, shadowsActive, buildingsBbox, shadowIndex, sun, proj],
  );

  // --- GeoJSON para MapLibre ---
  const barsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: evaluated.map(({ bar, ev }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [bar.lng, bar.lat] },
        properties: {
          name: bar.name,
          address: bar.address || '',
          terrace: bar.outdoorSeating || '',
          color: ev.color,
          emoji: ev.emoji,
          label: ev.label,
          note: ev.note,
        },
      })),
    }),
    [evaluated],
  );

  const shadowFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: shadows.map((s, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Polygon', coordinates: [s.ringLngLat] },
        properties: {},
      })),
    }),
    [shadows],
  );

  const buildingsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: mode3d
        ? buildings.map((b) => ({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [b.ring] },
            properties: { height: b.height },
          }))
        : [],
    }),
    [mode3d, buildings],
  );

  const onMoveEnd = useCallback((v) => setView(v), []);

  const wx = useMemo(() => (weather ? weatherAt(weather, date) : null), [weather, date]);
  const fmt = (d) =>
    d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--';

  const retry = () => {
    setBarsState('loading');
    fetchBars(SEVILLA.bbox)
      .then((d) => {
        setBars(d);
        setBarsState('ok');
      })
      .catch(() => setBarsState('error'));
  };

  const zoomLow = mode3d && view && view.zoom < MIN_ZOOM_3D;
  const visibleMeta = mode3d
    ? [CATEGORY.SUN, CATEGORY.SHADE, CATEGORY.NIGHT].map((c) => CATEGORY_META[c])
    : Object.values(CATEGORY_META);

  return (
    <div className="app">
      <MapView
        barsFC={barsState === 'ok' ? barsFC : null}
        shadowFC={shadowFC}
        buildingsFC={buildingsFC}
        mode3d={mode3d}
        theme={theme}
        sun={sun}
        onMoveEnd={onMoveEnd}
      />

      <header className="topbar">
        <h1>
          🍺 CerveMap <span className="sub">Sevilla · sol y sombra</span>
        </h1>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
            title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            className={`mode-btn ${mode3d ? 'active' : ''}`}
            onClick={() => setMode3d((v) => !v)}
            aria-pressed={mode3d}
            title="Vista 3D con sombras reales de edificios"
          >
            {mode3d ? '🏙️ 3D · sombras' : '🗺️ 2D'}
          </button>
          <button
            className="toggle-panel"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
          >
            {panelOpen ? 'Ocultar' : 'Panel'}
          </button>
        </div>
      </header>

      <section className={`panel ${panelOpen ? 'open' : 'closed'}`}>
        <div className="panel-grid">
          <SunCompass sun={sun} />
          <div className="info-block">
            <div className="info-row">
              <span className="muted">Estado solar</span>
              <strong>
                {sun.isUp
                  ? `Sol a ${Math.round(sun.altitudeDeg)}° sobre el horizonte`
                  : 'Sol bajo el horizonte'}
              </strong>
            </div>
            <div className="info-row">
              <span className="muted">Amanecer / Atardecer</span>
              <strong>
                {fmt(sunTimes.sunrise)} · {fmt(sunTimes.sunset)}
              </strong>
            </div>
            <div className="info-row">
              <span className="muted">Tiempo</span>
              <strong>
                {wx && wx.temperature != null
                  ? `${weatherEmoji(wx.code)} ${Math.round(wx.temperature)}°C · ${weatherText(wx.code)}`
                  : weather
                    ? 'Sin dato para esta hora'
                    : 'Cargando meteo…'}
              </strong>
            </div>
            {wx && wx.cloudCover != null && (
              <div className="info-row">
                <span className="muted">Nubosidad</span>
                <strong>{wx.cloudCover}%</strong>
              </div>
            )}
          </div>
        </div>

        <TimeControls date={date} onChange={setDate} />

        <div className="legend">
          {visibleMeta.map((m) => (
            <span className="legend-item" key={m.label}>
              <i style={{ background: m.color }} /> {m.label}
            </span>
          ))}
        </div>

        {/* Estado del modo sombra */}
        {shadowsActive ? (
          <p className="disclaimer ok">
            ✅ <strong>Sombras reales</strong> calculadas con la geometría y altura
            de {buildings.length} edificios de OSM para esta hora.
            {assumedCount > 0 &&
              ` ${assumedCount} no declaran altura: se asume ~9 m (3 plantas).`}{' '}
            Aproximación geométrica (no considera salientes ni vegetación).
          </p>
        ) : mode3d ? (
          <p className="disclaimer">
            🏙️ Modo 3D activo.{' '}
            {zoomLow
              ? 'Acércate con el zoom para cargar edificios y calcular sombras reales.'
              : buildingsState === 'loading'
                ? 'Cargando edificios…'
                : buildingsState === 'error'
                  ? 'No se pudieron cargar los edificios.'
                  : !sun.isUp
                    ? 'El sol está bajo el horizonte: no hay sombras que proyectar.'
                    : 'Mueve el mapa sobre una zona con edificios.'}
          </p>
        ) : (
          <p className="disclaimer">
            ⚠️ Modo 2D: clasificación por <strong>heurística</strong> (altura del
            sol + terraza de OSM), sin sombras reales. Activa <strong>3D ·
            sombras</strong> para el cálculo geométrico con edificios.
          </p>
        )}
      </section>

      {/* Overlays de estado */}
      {barsState === 'loading' && (
        <div className="overlay">
          <div className="spinner" />
          <p>Buscando bares en Sevilla…</p>
        </div>
      )}
      {barsState === 'error' && (
        <div className="overlay">
          <p>No se pudieron cargar los bares (Overpass).</p>
          <button className="now-btn" onClick={retry} type="button">
            Reintentar
          </button>
        </div>
      )}
      {barsState === 'ok' && bars.length === 0 && (
        <div className="overlay">
          <p>No se encontraron bares en esta zona.</p>
        </div>
      )}

      {barsState === 'ok' && bars.length > 0 && (
        <div className="count-badge">
          {bars.length} bares
          {mode3d && buildingsState === 'loading' && ' · cargando edificios…'}
          {shadowsActive && ` · ${shadows.length} sombras`}
        </div>
      )}
    </div>
  );
}
