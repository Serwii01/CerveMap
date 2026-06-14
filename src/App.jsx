import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import TimeControls from './components/TimeControls.jsx';
import SunCompass from './components/SunCompass.jsx';
import {
  fetchBars,
  fetchBuildings,
  barsCacheInfo,
  hasTerrace,
  SEVILLA,
} from './lib/overpass.js';
import {
  fetchWeather,
  weatherAt,
  weatherText,
  weatherEmoji,
} from './lib/weather.js';
import { getSunPosition, getSunTimes } from './lib/sun.js';
import { classifyBar, classifyByShadow, CATEGORY_META, CATEGORY } from './lib/classify.js';
import { openState } from './lib/hours.js';
import { haversine, distanceText, formatDistance, walkMinutes, rankScore } from './lib/geo.js';
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

/** Texto relativo "hace X" a partir de un timestamp. */
function formatAgo(ts) {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export default function App() {
  const [date, setDate] = useState(() => new Date());
  const [bars, setBars] = useState([]);
  const [barsState, setBarsState] = useState('loading');
  const [weather, setWeather] = useState(null);
  const [barsSavedAt, setBarsSavedAt] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const [mode3d, setMode3d] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyTerrace, setOnlyTerrace] = useState(false);
  const [userLoc, setUserLoc] = useState(null); // {lat,lng}
  const [geoState, setGeoState] = useState('idle'); // idle|locating|denied|error
  const [focus, setFocus] = useState(null); // {lng,lat,zoom,key}
  const [canInstall, setCanInstall] = useState(false);
  const installEvent = useRef(null);
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

  // --- PWA: captura el evento de instalación para el banner "Instalar" ---
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      installEvent.current = e;
      if (localStorage.getItem('cervemap-install-dismissed') !== '1') setCanInstall(true);
    };
    const onInstalled = () => {
      setCanInstall(false);
      installEvent.current = null;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installApp = async () => {
    const e = installEvent.current;
    if (!e) return;
    e.prompt();
    await e.userChoice;
    installEvent.current = null;
    setCanInstall(false);
  };
  const dismissInstall = () => {
    localStorage.setItem('cervemap-install-dismissed', '1');
    setCanInstall(false);
  };

  const proj = useMemo(() => makeProjector(LAT, LNG), []);
  const sun = useMemo(() => getSunPosition(date, LAT, LNG), [date]);
  const sunTimes = useMemo(() => getSunTimes(date, LAT, LNG), [date]);

  // --- Carga de bares (con caché IndexedDB; force omite el caché) ---
  const barsCtrl = useRef(null);
  const loadBars = useCallback((force = false) => {
    barsCtrl.current?.abort();
    const ctrl = new AbortController();
    barsCtrl.current = ctrl;
    setBarsState('loading');
    fetchBars(SEVILLA.bbox, ctrl.signal, { force })
      .then((d) => {
        setBars(d);
        setBarsState('ok');
        barsCacheInfo().then((m) => setBarsSavedAt(m?.savedAt ?? Date.now()));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setBarsState('error');
      });
  }, []);

  useEffect(() => {
    loadBars(false);
    return () => barsCtrl.current?.abort();
  }, [loadBars]);

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
  const heightStats = useMemo(() => {
    let catastro = 0, osm = 0, fallback = 0;
    if (shadowsActive) {
      for (const b of buildings) {
        if (b.heightSource === 'catastro') catastro++;
        else if (b.heightSource === 'fallback') fallback++;
        else osm++;
      }
    }
    return { catastro, osm, fallback };
  }, [shadowsActive, buildings]);

  // --- Evaluacion de cada bar ---
  const evaluated = useMemo(
    () =>
      bars.map((bar) => {
        const useShadow =
          shadowsActive && buildingsBbox && inBbox([bar.lng, bar.lat], buildingsBbox);
        const ev = useShadow
          ? classifyByShadow(sun, isInAnyShadowIndexed([bar.lng, bar.lat], shadowIndex, proj))
          : classifyBar(sun, bar);
        return {
          bar,
          ev,
          real: useShadow,
          open: openState(bar.openingHours, date),
          terrace: hasTerrace(bar),
          dist: userLoc ? haversine(userLoc, { lat: bar.lat, lng: bar.lng }) : null,
        };
      }),
    [bars, shadowsActive, buildingsBbox, shadowIndex, sun, proj, date, userLoc],
  );

  // Lista ordenada por cercanía + sol (solo con ubicación conocida).
  const ranked = useMemo(() => {
    if (!userLoc) return [];
    return evaluated
      .filter(({ open, terrace }) => {
        if (onlyOpen && open === 'closed') return false;
        if (onlyTerrace && !terrace) return false;
        return true;
      })
      .map((e) => ({ ...e, score: rankScore(e.dist ?? Infinity, e.ev.category) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [evaluated, userLoc, onlyOpen, onlyTerrace]);

  // --- GeoJSON para MapLibre ---
  const barsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: evaluated
        // "Solo abiertos" oculta los confirmados cerrados (los de horario
        // desconocido se mantienen porque no se puede afirmar que estén cerrados).
        .filter(({ open, terrace }) => {
          if (onlyOpen && open === 'closed') return false;
          if (onlyTerrace && !terrace) return false;
          return true;
        })
        .map(({ bar, ev, open, terrace, dist }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [bar.lng, bar.lat] },
          properties: {
            name: bar.name,
            address: bar.address || '',
            terrace: terrace ? 'yes' : bar.outdoorSeating === 'no' ? 'no' : '',
            open,
            dist: dist != null ? distanceText(dist) : '',
            color: ev.color,
            emoji: ev.emoji,
            label: ev.label,
            note: ev.note,
          },
        })),
    }),
    [evaluated, onlyOpen, onlyTerrace],
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

  const focusKey = useRef(0);
  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoState('error');
      return;
    }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(loc);
        setGeoState('idle');
        setFocus({ lng: loc.lng, lat: loc.lat, zoom: 15, key: ++focusKey.current });
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const focusBar = useCallback((bar) => {
    setFocus({ lng: bar.lng, lat: bar.lat, zoom: 17, key: ++focusKey.current });
  }, []);

  const wx = useMemo(() => (weather ? weatherAt(weather, date) : null), [weather, date]);
  const fmt = (d) =>
    d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--';

  const dataAgo = formatAgo(barsSavedAt);

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
        focus={focus}
        userLoc={userLoc}
      />

      {canInstall && (
        <div className="install-banner" role="dialog" aria-label="Instalar CerveMap">
          <span>
            📲 Instala <strong>CerveMap</strong> para abrirla como una app
          </span>
          <div className="install-actions">
            <button className="now-btn" type="button" onClick={installApp}>
              Instalar
            </button>
            <button className="link-btn" type="button" onClick={dismissInstall}>
              Ahora no
            </button>
          </div>
        </div>
      )}

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

        <div className="nearme-row">
          <button
            type="button"
            className="nearme-btn"
            onClick={locateMe}
            disabled={geoState === 'locating'}
          >
            {geoState === 'locating' ? '📍 Localizando…' : 'Cerca de mí ☀️'}
          </button>
          {geoState === 'denied' && (
            <span className="muted geo-msg">Permiso de ubicación denegado</span>
          )}
          {geoState === 'error' && (
            <span className="muted geo-msg">Geolocalización no disponible</span>
          )}
        </div>

        {ranked.length > 0 && (
          <ul className="ranked">
            {ranked.map(({ bar, ev, open, dist }) => (
              <li key={bar.id}>
                <button type="button" className="ranked-item" onClick={() => focusBar(bar)}>
                  <span className="ranked-dot" style={{ background: ev.color }} />
                  <span className="ranked-main">
                    <span className="ranked-name">
                      {bar.name}
                      {open === 'open' && ' 🟢'}
                      {open === 'closed' && ' 🔴'}
                    </span>
                    <span className="ranked-meta muted">
                      {ev.emoji} {ev.label}
                      {dist != null && ` · ${formatDistance(dist)} · ${walkMinutes(dist)} min`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="filters">
          <button
            type="button"
            className={`filter-chip ${onlyOpen ? 'active' : ''}`}
            aria-pressed={onlyOpen}
            onClick={() => setOnlyOpen((v) => !v)}
            title="Oculta los bares confirmados como cerrados a la hora elegida"
          >
            🕒 Solo abiertos ahora
          </button>
          <button
            type="button"
            className={`filter-chip ${onlyTerrace ? 'active' : ''}`}
            aria-pressed={onlyTerrace}
            onClick={() => setOnlyTerrace((v) => !v)}
            title="Solo bares con terraza exterior confirmada en OSM"
          >
            ☂️ Con terraza
          </button>
        </div>

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
            de {buildings.length} edificios para esta hora.{' '}
            {heightStats.osm} con altura de OSM
            {heightStats.catastro > 0 && (
              <>
                , <strong>{heightStats.catastro} con altura real del Catastro</strong>
              </>
            )}
            {heightStats.fallback > 0 && `, ${heightStats.fallback} estimados en ~9 m`}.
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

        <div className="data-status">
          <span className="muted">
            {barsState === 'loading'
              ? 'Actualizando datos del mapa…'
              : dataAgo
                ? `Datos del mapa actualizados ${dataAgo}`
                : 'Datos del mapa en caché local'}
          </span>
          <button
            className="link-btn"
            type="button"
            onClick={() => loadBars(true)}
            disabled={barsState === 'loading'}
          >
            ↻ Recargar
          </button>
        </div>
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
          <button className="now-btn" onClick={() => loadBars(false)} type="button">
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
        <div className="badges">
          <div className="count-badge">
            {bars.length} bares
            {mode3d && buildingsState === 'loading' && ' · cargando edificios…'}
            {shadowsActive && ` · ${shadows.length} sombras`}
          </div>
          {heightStats.catastro > 0 && (
            <div className="count-badge catastro" title="Alturas reales del Catastro español">
              🏛️ {heightStats.catastro} con altura real del Catastro
            </div>
          )}
        </div>
      )}
    </div>
  );
}
