import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { buildClusterIndex, queryClusters } from '../lib/cluster.js';
import { circlePolygon } from '../lib/geo.js';

const CARTO_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · &copy; <a href="https://carto.com/">CARTO</a>';

const tiles = (style) =>
  ['a', 'b', 'c'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`,
  );

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
    // Glyphs públicos (sin clave) para las etiquetas de los clusters.
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
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
  const web = p.website
    ? `<div class="popup-web"><a href="${p.website}" target="_blank" rel="noopener">🔗 Web</a></div>`
    : '';
  return `
    <div class="popup">
      <strong class="popup-name">${p.name}</strong>
      ${p.address ? `<div class="popup-addr">${p.address}</div>` : ''}
      <div class="popup-eval" style="color:${p.color}">${p.emoji} ${p.label}</div>
      <div class="popup-note">${p.note}</div>
      ${p.dist ? `<div class="popup-dist">📍 ${p.dist}</div>` : ''}
      <div class="popup-open muted">${open}</div>
      <div class="popup-terrace muted">${terrace}</div>
      ${web}
    </div>`;
}

// Iluminacion direccional de los edificios segun la posicion del sol.
function sunLight(sun) {
  if (!sun.isUp) {
    return { anchor: 'map', position: [1.5, 0, 25], color: '#aab4c8', intensity: 0.2 };
  }
  const polar = Math.max(8, 90 - sun.altitudeDeg);
  return { anchor: 'map', position: [1.5, sun.azimuthDeg, polar], color: '#fff4e0', intensity: 0.45 };
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
  initialCenter,
  initialZoom = 14,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const moveCb = useRef(onMoveEnd);
  moveCb.current = onMoveEnd;

  const shadowRef = useRef(EMPTY);
  const buildingRef = useRef(EMPTY);
  shadowRef.current = shadowFC || EMPTY;
  buildingRef.current = buildingsFC || EMPTY;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const sunRef = useRef(sun);
  sunRef.current = sun;

  // Índice de clustering + función para refrescar (recalcula al mover/zoom).
  const clusterIndexRef = useRef(null);
  const updateClustersRef = useRef(() => {});
  updateClustersRef.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const idx = clusterIndexRef.current;
    if (!idx) {
      map.getSource('clusters')?.setData(EMPTY);
      map.getSource('bars')?.setData(EMPTY);
      return;
    }
    const b = map.getBounds();
    const { clusters, points } = queryClusters(
      idx,
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      map.getZoom(),
    );
    map.getSource('clusters')?.setData({ type: 'FeatureCollection', features: clusters });
    map.getSource('bars')?.setData({ type: 'FeatureCollection', features: points });
  };

  // Inicializa el mapa una vez.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(themeRef.current),
      center: initialCenter || [-5.9845, 37.3891],
      zoom: initialZoom,
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
      updateClustersRef.current();
    };

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    map.on('load', () => {
      const t = THEMES[themeRef.current];
      map.setLight(sunLight(sunRef.current));

      map.addSource('user-accuracy', { type: 'geojson', data: EMPTY });
      map.addSource('shadows', { type: 'geojson', data: EMPTY });
      map.addSource('buildings', { type: 'geojson', data: EMPTY });
      map.addSource('clusters', { type: 'geojson', data: EMPTY });
      map.addSource('bars', { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: 'user-accuracy',
        type: 'fill',
        source: 'user-accuracy',
        paint: { 'fill-color': '#2f6df0', 'fill-opacity': 0.12 },
      });
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
      // Bares individuales (no agrupados).
      map.addLayer({
        id: 'bars',
        type: 'circle',
        source: 'bars',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 19, 11],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': t.barStroke,
          'circle-opacity': ['case', ['==', ['get', 'open'], 'closed'], 0.3, 0.95],
          'circle-stroke-opacity': ['case', ['==', ['get', 'open'], 'closed'], 0.3, 1],
        },
      });
      // Clusters.
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'clusters',
        paint: {
          'circle-color': ['get', 'clusterColor'],
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16, 10, 20, 50, 26, 200, 34,
          ],
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'clusters',
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#10131a' },
      });

      readyRef.current = true;
      map.getSource('shadows').setData(shadowRef.current);
      map.getSource('buildings').setData(buildingRef.current);
      updateClustersRef.current();
      emitMove();
    });

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' });
    map.on('click', 'bars', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      popup.setLngLat(f.geometry.coordinates).setHTML(popupHTML(f.properties)).addTo(map);
    });
    // Click en cluster: acercar para desagrupar.
    map.on('click', 'clusters', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      map.flyTo({ center: f.geometry.coordinates, zoom: Math.min(map.getZoom() + 2, 20), speed: 1.2 });
    });
    const pointer = (id) => {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    };
    pointer('bars');
    pointer('clusters');
    map.on('moveend', emitMove);

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconstruye el índice de clusters cuando cambian los bares.
  useEffect(() => {
    clusterIndexRef.current =
      barsFC && barsFC.features.length ? buildClusterIndex(barsFC.features) : null;
    updateClustersRef.current();
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

  // Vuela a un punto cuando cambia `focus`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focus) return;
    const opts = { center: [focus.lng, focus.lat], zoom: focus.zoom ?? map.getZoom() };
    // En seguimiento usamos easeTo (suave); en saltos puntuales, flyTo.
    if (focus.ease) map.easeTo({ ...opts, duration: 800 });
    else map.flyTo({ ...opts, speed: 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  // Marcador de la posición del usuario + anillo de precisión.
  const userMarkerRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!userLoc) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.getSource('user-accuracy')?.setData(EMPTY);
      return;
    }
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      userMarkerRef.current = new maplibregl.Marker({ element: el });
    }
    userMarkerRef.current.setLngLat([userLoc.lng, userLoc.lat]).addTo(map);
    const acc = userLoc.accuracy && userLoc.accuracy > 0 ? Math.min(userLoc.accuracy, 2000) : 0;
    map.getSource('user-accuracy')?.setData(
      acc
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [circlePolygon(userLoc.lat, userLoc.lng, acc)],
                },
                properties: {},
              },
            ],
          }
        : EMPTY,
    );
  }, [userLoc]);

  return <div ref={containerRef} className="map" />;
}
