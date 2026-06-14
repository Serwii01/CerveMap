import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { SEVILLA } from '../lib/overpass.js';

const CARTO_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · &copy; <a href="https://carto.com/">CARTO</a>';

const tiles = (style) =>
  ['a', 'b', 'c'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`,
  );

// Paletas por tema. El modo claro hace que la sombra proyectada se vea bien.
const THEMES = {
  light: {
    base: tiles('light_all'),
    building: '#c9d1de',
    shadowFill: '#2f3c56',
    shadowFillOpacity: 0.5,
    shadowLine: '#1f2940',
    shadowLineOpacity: 0.75,
    barStroke: 'rgba(20,28,42,0.85)',
  },
  dark: {
    base: tiles('dark_all'),
    building: '#39414f',
    shadowFill: '#01030a',
    shadowFillOpacity: 0.45,
    shadowLine: '#7c8cff',
    shadowLineOpacity: 0.65,
    barStroke: 'rgba(255,255,255,0.85)',
  },
};

const EMPTY = { type: 'FeatureCollection', features: [] };

function makeStyle(theme) {
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: THEMES[theme].base,
        tileSize: 256,
        attribution: CARTO_ATTR,
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  };
}

function popupHTML(p) {
  const terrace =
    p.terrace === 'yes'
      ? 'Terraza: sí (OSM)'
      : p.terrace === 'no'
        ? 'Terraza: no (OSM)'
        : 'Terraza: sin datos';
  const open =
    p.open === 'open'
      ? '🟢 Abierto ahora'
      : p.open === 'closed'
        ? '🔴 Cerrado ahora'
        : '⚪ Horario sin datos';
  return `
    <div class="popup">
      <strong class="popup-name">${p.name}</strong>
      ${p.address ? `<div class="popup-addr">${p.address}</div>` : ''}
      <div class="popup-eval" style="color:${p.color}">${p.emoji} ${p.label}</div>
      <div class="popup-note">${p.note}</div>
      ${p.dist ? `<div class="popup-dist">📍 ${p.dist}</div>` : ''}
      <div class="popup-open muted">${open}</div>
      <div class="popup-terrace muted">${terrace}</div>
    </div>`;
}

// Iluminacion direccional de los edificios segun la posicion del sol.
function sunLight(sun) {
  if (!sun.isUp) {
    return { anchor: 'map', position: [1.5, 0, 25], color: '#aab4c8', intensity: 0.2 };
  }
  const polar = Math.max(8, 90 - sun.altitudeDeg); // 0 = cenit
  return {
    anchor: 'map',
    position: [1.5, sun.azimuthDeg, polar],
    color: '#fff4e0',
    intensity: 0.45,
  };
}

export default function MapView({
  barsFC,
  shadowFC,
  buildingsFC,
  mode3d,
  theme,
  sun,
  onMoveEnd,
  focus,
  userLoc,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const moveCb = useRef(onMoveEnd);
  moveCb.current = onMoveEnd;

  const barsRef = useRef(EMPTY);
  const shadowRef = useRef(EMPTY);
  const buildingRef = useRef(EMPTY);
  barsRef.current = barsFC || EMPTY;
  shadowRef.current = shadowFC || EMPTY;
  buildingRef.current = buildingsFC || EMPTY;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const sunRef = useRef(sun);
  sunRef.current = sun;

  // Inicializa el mapa una vez.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(themeRef.current),
      center: [SEVILLA.center[1], SEVILLA.center[0]],
      zoom: 14,
      attributionControl: { compact: true },
      maxPitch: 75,
    });
    mapRef.current = map;

    const emitMove = () => {
      const b = map.getBounds();
      moveCb.current?.({
        bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()],
        zoom: map.getZoom(),
      });
    };

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'bottom-right');

    map.on('load', () => {
      const t = THEMES[themeRef.current];
      map.setLight(sunLight(sunRef.current));

      map.addSource('shadows', { type: 'geojson', data: EMPTY });
      map.addSource('buildings', { type: 'geojson', data: EMPTY });
      map.addSource('bars', { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: 'shadows',
        type: 'fill',
        source: 'shadows',
        paint: { 'fill-color': t.shadowFill, 'fill-opacity': t.shadowFillOpacity },
      });
      map.addLayer({
        id: 'shadows-outline',
        type: 'line',
        source: 'shadows',
        paint: {
          'line-color': t.shadowLine,
          'line-width': 1.1,
          'line-opacity': t.shadowLineOpacity,
        },
      });
      map.addLayer({
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'buildings',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': t.building,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-vertical-gradient': true,
        },
      });
      map.addLayer({
        id: 'bars',
        type: 'circle',
        source: 'bars',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 19, 11],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': t.barStroke,
          // Los bares confirmados cerrados se atenúan.
          'circle-opacity': ['case', ['==', ['get', 'open'], 'closed'], 0.3, 0.95],
          'circle-stroke-opacity': ['case', ['==', ['get', 'open'], 'closed'], 0.3, 1],
        },
      });

      readyRef.current = true;
      map.getSource('bars').setData(barsRef.current);
      map.getSource('shadows').setData(shadowRef.current);
      map.getSource('buildings').setData(buildingRef.current);
      emitMove();
    });

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' });
    map.on('click', 'bars', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      popup.setLngLat(e.lngLat).setHTML(popupHTML(f.properties)).addTo(map);
    });
    map.on('mouseenter', 'bars', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'bars', () => (map.getCanvas().style.cursor = ''));
    map.on('moveend', emitMove);

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Datos.
  useEffect(() => {
    if (readyRef.current) mapRef.current.getSource('bars')?.setData(barsFC || EMPTY);
  }, [barsFC]);
  useEffect(() => {
    if (readyRef.current) mapRef.current.getSource('shadows')?.setData(shadowFC || EMPTY);
  }, [shadowFC]);
  useEffect(() => {
    if (readyRef.current) mapRef.current.getSource('buildings')?.setData(buildingsFC || EMPTY);
  }, [buildingsFC]);

  // Modo 3D: inclina la camara y muestra edificios.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLayoutProperty('buildings', 'visibility', mode3d ? 'visible' : 'none');
    map.easeTo({ pitch: mode3d ? 55 : 0, duration: 600 });
  }, [mode3d]);

  // Iluminacion segun el sol.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLight(sunLight(sun));
  }, [sun]);

  // Cambio de tema: basemap + colores de capas.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const t = THEMES[theme];
    map.getSource('carto')?.setTiles(t.base);
    map.setPaintProperty('shadows', 'fill-color', t.shadowFill);
    map.setPaintProperty('shadows', 'fill-opacity', t.shadowFillOpacity);
    map.setPaintProperty('shadows-outline', 'line-color', t.shadowLine);
    map.setPaintProperty('shadows-outline', 'line-opacity', t.shadowLineOpacity);
    map.setPaintProperty('buildings', 'fill-extrusion-color', t.building);
    map.setPaintProperty('bars', 'circle-stroke-color', t.barStroke);
  }, [theme]);

  // Vuela a un punto cuando cambia `focus` (mi ubicación o un bar de la lista).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? map.getZoom(), speed: 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  // Marcador de la posición del usuario.
  const userMarkerRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!userLoc) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      userMarkerRef.current = new maplibregl.Marker({ element: el });
    }
    userMarkerRef.current.setLngLat([userLoc.lng, userLoc.lat]).addTo(map);
  }, [userLoc]);

  return <div ref={containerRef} className="map" />;
}
