import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import TimeControls from './components/TimeControls.jsx';
import SunCompass from './components/SunCompass.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import FilterBar from './components/FilterBar.jsx';
import {
  fetchBarsInBbox,
  fetchBuildings,
  barsCacheInfo,
  hasTerrace,
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
import { haversine, distanceText, formatDistance, walkMinutes } from './lib/geo.js';
import { makeProjector, prepareBuilding, computeShadowData } from './lib/geometry.js';
import { expandBbox, bboxCenter } from './lib/viewport.js';
import { getNewTiles, loadTilesConcurrent } from './lib/tiles.js';
import { SEVILLA_CITY, loadSavedCity, saveCity } from './lib/city.js';

const MIN_ZOOM_3D = 15;
const MAX_BARS = 3000;
const INITIAL_ZOOM = 14;

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

/** Une bares previos + nuevos (dedupe por id) y limita a `cap` por cercanía al centro. */
function mergeBars(prev, incoming, center, cap = MAX_BARS) {
  const byId = new Map();
  for (const b of prev) byId.set(b.id, b);
  for (const b of incoming) byId.set(b.id, b);
  let arr = Array.from(byId.values());
  if (arr.length > cap) {
    const [cx, cy] = center;
    const d2 = (b) => (b.lng - cx) ** 2 + (b.lat - cy) ** 2;
    arr.sort((a, b) => d2(a) - d2(b));
    arr = arr.slice(0, cap);
  }
  return arr;
}

export default function App() {
  const [city, setCity] = useState(() => loadSavedCity());
  const LAT = city?.lat ?? SEVILLA_CITY.lat;
  const LNG = city?.lon ?? SEVILLA_CITY.lon;

  const [date, setDate] = useState(() => new Date());
  const [bars, setBars] = useState([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [barsError, setBarsError] = useState(false);
  const [barsSavedAt, setBarsSavedAt] = useState(null);
  const [weather, setWeather] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const [mode3d, setMode3d] = useState(false);
  const [filters, setFilters] = useState({ onlySun: false, onlyTerrace: false, onlyOpen: false });
  const [filterCollapsed, setFilterCollapsed] = useState(true);
  const [userLoc, setUserLoc] = useState(null); // {lat,lng,accuracy}
  const [tracking, setTracking] = useState(false);
  const [toast, setToast] = useState(null);
  const [focus, setFocus] = useState(null);
  const [canInstall, setCanInstall] = useState(false);
  const installEvent = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('cervemap-theme') || 'light');

  const [buildings, setBuildings] = useState([]);
  const [buildingsState, setBuildingsState] = useState('idle');
  const [view, setView] = useState(null);

  const [shadowStates, setShadowStates] = useState(null); // Uint8Array
  const [shadowRings, setShadowRings] = useState([]);

  const loadedTilesRef = useRef(new Set());
  const lastFetchKey = useRef(null);
  const barsCtrl = useRef(null);
  const focusKey = useRef(0);
  const watchRef = useRef(null);
  const recenterRef = useRef({ t: 0, lat: 0, lng: 0 });

  // --- Tema ---
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cervemap-theme', theme);
  }, [theme]);

  // --- PWA: banner de instalación ---
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

  const sun = useMemo(() => getSunPosition(date, LAT, LNG), [date, LAT, LNG]);
  const sunTimes = useMemo(() => getSunTimes(date, LAT, LNG), [date, LAT, LNG]);

  // ===== Selección de ciudad =====
  const selectCity = useCallback((c, loc = null) => {
    saveCity(c);
    setBars([]);
    setBuildings([]);
    setBuildingsState('idle');
    setShadowStates(null);
    setShadowRings([]);
    setWeather(null);
    setBarsError(false);
    loadedTilesRef.current = new Set();
    lastFetchKey.current = null;
    if (loc) setUserLoc(loc);
    setCity(c);
  }, []);
  const changeCity = () => setCity(null);

  // ===== Web Worker de sombras =====
  const workerRef = useRef(null);
  const latestReqId = useRef(0);
  const pendingRef = useRef(null);
  const rafRef = useRef(0);
  const barsLenRef = useRef(0);
  barsLenRef.current = bars.length;

  useEffect(() => {
    let worker = null;
    try {
      worker = new Worker(new URL('./workers/shadows.worker.js', import.meta.url), { type: 'module' });
    } catch {
      worker = null; // fallback al hilo principal
    }
    workerRef.current = worker;
    if (worker) {
      worker.onmessage = (e) => {
        const { reqId, states, rings } = e.data;
        if (reqId !== latestReqId.current) return; // descarta respuestas viejas
        pendingRef.current = { states, rings };
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const p = pendingRef.current;
            pendingRef.current = null;
            if (p && p.states.length === barsLenRef.current) {
              setShadowStates(p.states);
              setShadowRings(p.rings);
            }
          });
        }
      };
    }
    return () => {
      worker?.terminate();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Envía los edificios al worker (se preparan una sola vez).
  useEffect(() => {
    const w = workerRef.current;
    if (!w || !mode3d || buildings.length === 0) return;
    w.postMessage({
      type: 'setBuildings',
      origin: [LAT, LNG],
      buildings: buildings.map((b) => ({ ring: b.ring, height: b.height })),
    });
  }, [buildings, mode3d, LAT, LNG]);

  // Recalcula estados de sombra al cambiar sol / bares / edificios.
  useEffect(() => {
    if (!mode3d || !sun.isUp || buildings.length === 0 || bars.length === 0) {
      setShadowStates(null);
      setShadowRings([]);
      return;
    }
    const coords = new Float64Array(bars.length * 2);
    for (let i = 0; i < bars.length; i++) {
      coords[2 * i] = bars[i].lng;
      coords[2 * i + 1] = bars[i].lat;
    }
    const reqId = ++latestReqId.current;
    const sunMsg = { isUp: sun.isUp, azimuthDeg: sun.azimuthDeg, altitudeDeg: sun.altitudeDeg };
    const w = workerRef.current;
    if (w) {
      w.postMessage({ type: 'compute', reqId, sun: sunMsg, coords }, [coords.buffer]);
    } else {
      const proj = makeProjector(LAT, LNG);
      const prepared = buildings.map((b) => prepareBuilding(b, proj));
      const { states, rings } = computeShadowData(prepared, sunMsg, coords, [LAT, LNG]);
      setShadowStates(states);
      setShadowRings(rings);
    }
  }, [mode3d, sun, buildings, bars, LAT, LNG]);

  // ===== Carga lazy de bares por TILES =====
  // bbox de la ciudad en [s,w,n,e] (city.bbox viene como [minlat,maxlat,minlon,maxlon]).
  const cityBboxSWNE = useMemo(() => {
    if (!city?.bbox) return null;
    const [minlat, maxlat, minlon, maxlon] = city.bbox;
    return [minlat, minlon, maxlat, maxlon];
  }, [city]);

  const loadTilesForView = useCallback(
    (v, force = false) => {
      if (!v) return;
      if (force) loadedTilesRef.current = new Set();
      const vp = expandBbox(v.bbox, 0.2);
      const tiles = getNewTiles(vp, cityBboxSWNE, loadedTilesRef.current);
      if (tiles.length === 0) return;
      for (const t of tiles) loadedTilesRef.current.add(t.id); // marca optimista
      barsCtrl.current?.abort();
      const ctrl = new AbortController();
      barsCtrl.current = ctrl;
      setBarsLoading(true);
      loadTilesConcurrent(
        tiles,
        (tile, sig) => fetchBarsInBbox(tile.bbox, sig, { force }),
        4,
        ctrl.signal,
      )
        .then(({ bars: incoming, failed }) => {
          if (ctrl.signal.aborted) return;
          // Los tiles que fallaron se desmarcan para poder reintentarlos.
          for (const id of failed) loadedTilesRef.current.delete(id);
          const center = bboxCenter(vp);
          setBars((prev) => mergeBars(prev, incoming, center));
          setBarsSavedAt(barsCacheInfo()?.savedAt ?? Date.now());
          setBarsError(failed.length === tiles.length && incoming.length === 0);
          setBarsLoading(false);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setBarsError(true);
            setBarsLoading(false);
          }
        });
    },
    [cityBboxSWNE],
  );

  // moveend (en `view`) con debounce de 500 ms.
  useEffect(() => {
    if (!view || !city) return;
    const t = setTimeout(() => loadTilesForView(view), 500);
    return () => clearTimeout(t);
  }, [view, city, loadTilesForView]);

  // --- Meteo (por ciudad) ---
  useEffect(() => {
    if (!city) return;
    const ctrl = new AbortController();
    fetchWeather(LAT, LNG, ctrl.signal).then(setWeather).catch(() => {});
    return () => ctrl.abort();
  }, [city, LAT, LNG]);

  // --- Edificios (modo 3D + zoom suficiente) por viewport ---
  useEffect(() => {
    if (!mode3d || !view || view.zoom < MIN_ZOOM_3D) return;
    const key = view.bbox.map((v) => v.toFixed(3)).join(',');
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;
    const ctrl = new AbortController();
    setBuildingsState('loading');
    fetchBuildings(view.bbox, ctrl.signal)
      .then((d) => {
        setBuildings(d);
        setBuildingsState('ok');
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setBuildingsState('error');
      });
    return () => ctrl.abort();
  }, [mode3d, view]);

  const heightStats = useMemo(() => {
    let catastro = 0, osm = 0, fallback = 0;
    if (mode3d && buildings.length) {
      for (const b of buildings) {
        if (b.heightSource === 'catastro') catastro++;
        else if (b.heightSource === 'fallback') fallback++;
        else osm++;
      }
    }
    return { catastro, osm, fallback };
  }, [mode3d, buildings]);

  const shadowsActive = mode3d && sun.isUp && buildings.length > 0;

  // --- Evaluación de cada bar (estado real del worker o heurística) ---
  const evaluated = useMemo(() => {
    const useReal = mode3d && sun.isUp && shadowStates && shadowStates.length === bars.length;
    return bars.map((bar, i) => {
      const ev = useReal ? classifyByShadow(sun, shadowStates[i] === 2) : classifyBar(sun, bar);
      return {
        bar,
        ev,
        real: useReal,
        open: openState(bar.openingHours, date),
        terrace: hasTerrace(bar),
        dist: userLoc ? haversine(userLoc, { lat: bar.lat, lng: bar.lng }) : null,
      };
    });
  }, [bars, mode3d, sun, shadowStates, date, userLoc]);

  const passesFilters = useCallback(
    ({ ev, open, terrace }) => {
      if (filters.onlySun && ev.category !== CATEGORY.SUN) return false;
      if (filters.onlyTerrace && !terrace) return false;
      if (filters.onlyOpen && open === 'closed') return false;
      return true;
    },
    [filters],
  );

  // Lista ordenada por cercanía + sol.
  const ranked = useMemo(() => {
    if (!userLoc) return [];
    return evaluated
      .filter(passesFilters)
      .map((e) => {
        const d = e.dist ?? Infinity;
        const score = (1 - Math.min(d / 500, 1)) * 0.5 + (e.ev.category === CATEGORY.SUN ? 1 : 0) * 0.5;
        return { ...e, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [evaluated, userLoc, passesFilters]);

  const barsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: evaluated.filter(passesFilters).map(({ bar, ev, open, terrace, dist }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [bar.lng, bar.lat] },
        properties: {
          name: bar.name,
          address: bar.address || '',
          website: bar.website || '',
          terrace: terrace ? 'yes' : bar.outdoorSeating === 'no' ? 'no' : '',
          open,
          dist: dist != null ? distanceText(dist) : '',
          cat: ev.category,
          color: ev.color,
          emoji: ev.emoji,
          label: ev.label,
          note: ev.note,
        },
      })),
    }),
    [evaluated, passesFilters],
  );

  const shadowFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: shadowRings.map((ring, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      })),
    }),
    [shadowRings],
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

  // ===== Geolocalización =====
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      showToast('Activa la ubicación para ver bares cercanos');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setUserLoc(loc);
        setFocus({ lng: loc.lng, lat: loc.lat, zoom: 16, key: ++focusKey.current });
      },
      () => showToast('Activa la ubicación para ver bares cercanos'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [showToast]);

  const toggleTracking = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setTracking(false);
      return;
    }
    if (!navigator.geolocation) {
      showToast('Activa la ubicación para ver bares cercanos');
      return;
    }
    setTracking(true);
    recenterRef.current = { t: 0, lat: 0, lng: 0 };
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setUserLoc(loc);
        // Recentra suavemente (easeTo) como mucho cada 5 s y solo si te has movido >20 m.
        const now = Date.now();
        const r = recenterRef.current;
        const moved = haversine({ lat: r.lat, lng: r.lng }, loc);
        if (now - r.t > 5000 && moved > 20) {
          recenterRef.current = { t: now, lat: loc.lat, lng: loc.lng };
          setFocus({ lng: loc.lng, lat: loc.lat, zoom: 16, key: ++focusKey.current, ease: true });
        }
      },
      () => {
        showToast('Activa la ubicación para ver bares cercanos');
        setTracking(false);
        watchRef.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
  }, [showToast]);

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
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

  // ===== Pantalla de inicio si no hay ciudad =====
  if (!city) return <WelcomeScreen onSelect={selectCity} />;

  return (
    <div className="app">
      <MapView
        key={`${city.lat},${city.lon}`}
        barsFC={barsFC}
        shadowFC={shadowFC}
        buildingsFC={buildingsFC}
        mode3d={mode3d}
        theme={theme}
        sun={sun}
        onMoveEnd={onMoveEnd}
        focus={focus}
        userLoc={userLoc}
        initialCenter={[city.lon, city.lat]}
        initialZoom={INITIAL_ZOOM}
      />

      {canInstall && (
        <div className="install-banner" role="dialog" aria-label="Instalar CerveMap">
          <span>
            📲 Instala <strong>CerveMap</strong> para abrirla como una app
          </span>
          <div className="install-actions">
            <button className="now-btn" type="button" onClick={installApp}>Instalar</button>
            <button className="link-btn" type="button" onClick={dismissInstall}>Ahora no</button>
          </div>
        </div>
      )}

      <header className="topbar">
        <h1>
          🍺 CerveMap <span className="sub">{city.name} · sol y sombra</span>
        </h1>
        <div className="topbar-actions">
          <button className="toggle-panel" onClick={changeCity} title="Cambiar de ciudad">
            🏙️ Cambiar ciudad
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            aria-label={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
            title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            className={`mode-btn ${mode3d ? 'active' : ''}`}
            onClick={() => setMode3d((v) => !v)}
            aria-pressed={mode3d}
            title="Vista 3D con sombras reales"
          >
            {mode3d ? '🏙️ 3D' : '🗺️ 2D'}
          </button>
          <button className="toggle-panel" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
            {panelOpen ? 'Ocultar' : 'Panel'}
          </button>
        </div>
      </header>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        collapsed={filterCollapsed}
        onToggleCollapsed={() => setFilterCollapsed((v) => !v)}
      />

      {/* Controles de geolocalización */}
      <div className="geo-controls">
        <button className="geo-btn" type="button" onClick={locateMe} title="Centrar en mi ubicación">
          📍 Cerca de mí
        </button>
        <button
          className={`geo-btn ${tracking ? 'active' : ''}`}
          type="button"
          onClick={toggleTracking}
          title="Seguir mi posición"
        >
          {tracking ? '🔄 Siguiéndote' : '🔄 Seguirme'}
        </button>
      </div>

      <section className={`panel ${panelOpen ? 'open' : 'closed'}`}>
        <div className="panel-grid">
          <SunCompass sun={sun} />
          <div className="info-block">
            <div className="info-row">
              <span className="muted">Estado solar</span>
              <strong>
                {sun.isUp ? `Sol a ${Math.round(sun.altitudeDeg)}° sobre el horizonte` : 'Sol bajo el horizonte'}
              </strong>
            </div>
            <div className="info-row">
              <span className="muted">Amanecer / Atardecer</span>
              <strong>{fmt(sunTimes.sunrise)} · {fmt(sunTimes.sunset)}</strong>
            </div>
            <div className="info-row">
              <span className="muted">Tiempo</span>
              <strong>
                {wx && wx.temperature != null
                  ? `${weatherEmoji(wx.code)} ${Math.round(wx.temperature)}°C · ${weatherText(wx.code)}`
                  : weather ? 'Sin dato para esta hora' : 'Cargando meteo…'}
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

        <div className="legend">
          {visibleMeta.map((m) => (
            <span className="legend-item" key={m.label}>
              <i style={{ background: m.color }} /> {m.label}
            </span>
          ))}
        </div>

        {shadowsActive ? (
          <p className="disclaimer ok">
            ✅ <strong>Sombras reales</strong> de {buildings.length} edificios para esta hora.{' '}
            {heightStats.osm} con altura de OSM
            {heightStats.catastro > 0 && (
              <>, <strong>{heightStats.catastro} con altura real del Catastro</strong></>
            )}
            {heightStats.fallback > 0 && `, ${heightStats.fallback} estimados en ~9 m`}.
            Cálculo en segundo plano (Web Worker).
          </p>
        ) : mode3d ? (
          <p className="disclaimer">
            🏙️ Modo 3D activo.{' '}
            {zoomLow
              ? 'Acércate con el zoom para cargar edificios y calcular sombras.'
              : buildingsState === 'loading'
                ? 'Cargando edificios…'
                : buildingsState === 'error'
                  ? 'No se pudieron cargar los edificios.'
                  : !sun.isUp
                    ? 'El sol está bajo el horizonte: no hay sombras.'
                    : 'Mueve el mapa sobre una zona con edificios.'}
          </p>
        ) : (
          <p className="disclaimer">
            ⚠️ Modo 2D: clasificación por <strong>heurística</strong> (altura del sol +
            terraza). Activa <strong>3D</strong> para sombras geométricas reales.
          </p>
        )}

        <div className="data-status">
          <span className="muted">
            {barsLoading
              ? 'Actualizando bares…'
              : dataAgo ? `Bares actualizados ${dataAgo}` : 'Mueve el mapa para cargar bares'}
          </span>
          <button
            className="link-btn"
            type="button"
            onClick={() => loadTilesForView(view, true)}
            disabled={barsLoading || !view}
          >
            ↻ Recargar
          </button>
        </div>
      </section>

      {/* Spinner sutil mientras se cargan bares */}
      {barsLoading && (
        <div className="mini-loading" aria-live="polite">
          <span className="mini-spinner" /> Cargando…
        </div>
      )}

      {barsError && bars.length === 0 && (
        <div className="overlay">
          <p>No se pudieron cargar los bares (Overpass).</p>
          <button className="now-btn" onClick={() => loadTilesForView(view, true)} type="button">
            Reintentar
          </button>
        </div>
      )}

      {bars.length > 0 && (
        <div className="badges">
          <div className="count-badge">
            {barsFC.features.length} bares
            {shadowsActive && ` · ${shadowRings.length} sombras`}
          </div>
          {heightStats.catastro > 0 && (
            <div className="count-badge catastro" title="Alturas reales del Catastro español">
              🏛️ {heightStats.catastro} con altura real del Catastro
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
