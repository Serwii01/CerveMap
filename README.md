# 🍺 CerveMap

Aplicación web **100% frontend** (sin backend, sin base de datos, sin claves
privadas) para **elegir bar en Sevilla según el sol y la sombra** a la hora que
quieras tomar una cerveza.

Centrada por defecto en Sevilla, muestra un mapa con todos los bares de
OpenStreetMap, la posición del sol (azimut + elevación) para la hora elegida, la
temperatura y el estado del cielo, y clasifica cada bar como sol/sombra. Incluye
una **vista 3D con la sombra REAL proyectada por los edificios**.

---

## Stack elegido y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Framework | **Vite + React 18** | Build estático rapidísimo, cero config para Vercel, mantenible. |
| Mapa + 3D | **MapLibre GL JS** | WebGL, sin API key, soporta inclinación (pitch) y **extrusión 3D de edificios** (`fill-extrusion`). |
| Búsqueda de ciudad | **Nominatim (OSM)** | Autocompletado y geocodificación inversa, sin API key. Escalable a toda España. |
| Clustering | **supercluster** | Agrupa miles de marcadores por viewport; color por mayoría sol/sombra. |
| Cálculo de sombras | **Web Worker** | El cálculo geométrico corre fuera del hilo principal (slider fluido). |
| Teselas base | **CARTO dark (OSM)** | Estética modo oscuro, sin clave. |
| Sol | **SunCalc** | Azimut/elevación calculados en el cliente, sin servidor. |
| Sombras | **Geometría propia** (`lib/geometry.js`) | Proyección real de sombras sin dependencias externas. |
| Meteo | **Open-Meteo** | Temperatura, nubosidad y código de cielo por hora, **sin API key**. |
| Bares y edificios | **Overpass API (OSM)** | Datos abiertos, sin backend ni clave. |
| Alturas reales | **Catastro (INSPIRE) → índice estático** | Altura real de edificios sin OSM `height`. Se procesa offline. |
| Caché | **IndexedDB (`idb`)** | Bares y edificios cacheados (24 h / 72 h) para carga instantánea. |
| Horarios | **`opening_hours`** | "Abierto ahora" parseado en cliente. |
| PWA | **`vite-plugin-pwa`** | Instalable y con assets cacheados offline. |
| Estilos | **CSS plano + variables** | Modo claro/oscuro y responsive sin peso extra. |

**Por qué este stack:** es el camino más simple y sólido para desplegar en
Vercel sin servidor. MapLibre aporta el 3D y la extrusión de edificios con WebGL
sin claves, y todas las fuentes de datos son APIs públicas y gratuitas que se
consumen directamente desde el navegador. React mantiene el estado claro sin
sobreingeniería.

---

## Arquitectura

```
index.html
public/
  data/seville-heights.json   # índice estático de alturas del Catastro (regenerable)
  pwa-icon.svg                # icono de la PWA
scripts/
  build-heights.mjs           # procesa el GML del Catastro -> seville-heights.json
src/
  main.jsx              # punto de entrada
  App.jsx               # estado global (ciudad, hora, bares, edificios, sombras, filtros, geo) + UI
  index.css             # tema claro/oscuro, mobile-first, responsive
  components/
    WelcomeScreen.jsx   # pantalla de inicio: buscador de ciudad + geolocalización
    MapView.jsx         # MapLibre: base, extrusión 3D, sombras, clustering, popups
    FilterBar.jsx       # barra de filtros sobre el mapa (sol / terraza / abiertos)
    TimeControls.jsx    # slider de hora, fecha y botón "Ahora"
    SunCompass.jsx      # brújula SVG con azimut y elevación
  workers/
    shadows.worker.js   # cálculo de sombras + estado de cada bar (fuera del hilo principal)
  lib/
    nominatim.js        # búsqueda de ciudad y reverse geocoding (Nominatim)
    city.js             # modelo de ciudad + persistencia en localStorage
    viewport.js         # bbox del viewport (margen 20%)
    tiles.js            # rejilla de tiles ~800 m + carga concurrente (allSettled)
    cluster.js          # índice supercluster + color por mayoría sol/sombra
    overpass.js         # fetch de bares por viewport y edificios (paralelo + caché)
    cache.js            # caché IndexedDB con TTL (idb)
    heights.js          # lookup de alturas reales del Catastro
    hours.js            # estado "abierto ahora" (opening_hours)
    geo.js              # distancia haversine, círculo de precisión y score
    weather.js          # fetch + parseo de Open-Meteo (caché por ciudad)
    sun.js              # posición solar (SunCalc) y utilidades
    classify.js         # heurística (2D) + clasificación por sombra real
    geometry.js         # proyección de sombras, índice espacial y tests
```

## 🌍 Escalable a toda España + carga lazy

La app ya no está fijada a Sevilla:

1. **Pantalla de inicio** (`WelcomeScreen`): busca cualquier ciudad de España con
   **Nominatim** (autocompletado con debounce de 300 ms y una sola petición
   activa), o usa **tu ubicación** (geolocalización + reverse geocoding). La
   última ciudad se guarda en `localStorage` y al reabrir salta directa al mapa.
   Botón **"Cambiar ciudad"** en la cabecera.
2. **Carga por TILES** (no por municipio entero): el área se trocea en tiles de
   **~800 m** (`lib/tiles.js`). Al dejar de mover el mapa (`moveend`, debounce
   500 ms) se calculan los tiles del viewport (∩ ciudad) que aún no están en
   memoria y se cargan **solo esos**, con **concurrencia 4** y `Promise.allSettled`
   (un tile que falle no tumba al resto; se reintenta luego). Los bares se
   **fusionan por id OSM** (dedupe) y se purgan los más lejanos si se superan
   **3000** en memoria. Cada tile tiene un bbox determinista → se **cachea de
   forma estable** en IndexedDB (TTL 1 h). Esto resuelve el problema de las
   ciudades grandes (Madrid, Barcelona): ya no se lanza una consulta gigante que
   se trunca, sino muchas pequeñas y rápidas.

   La consulta Overpass usa **`nwr`** (nodes + ways + relations) sobre
   `bar|pub|cafe|restaurant|beer_garden|biergarten|tavern` con `name`, y
   `out body center qt` (centroide de ways/relations, sin límite fijo).
3. **Clustering** (`supercluster`, `radius 60`, `maxZoom 16`): los marcadores se
   agrupan; el color del cluster es naranja si >60% están al sol, gris si >60% en
   sombra, amarillo si es mixto. Click en un cluster → `flyTo` con `zoom+2`.
4. **Sombras en Web Worker**: el cálculo geométrico (sombras de los edificios +
   estado sol/sombra de cada bar) corre en `workers/shadows.worker.js`. El
   resultado vuelve como `Uint8Array` **transferible** (sin copia); se descartan
   respuestas obsoletas por `reqId` y se aplica con *throttling* de
   `requestAnimationFrame`. Sin soporte de Worker, hay *fallback* al hilo
   principal. Así mover el slider de hora no bloquea la UI.

Flujo: `App` mantiene la **hora seleccionada** y recalcula la posición solar y la
meteo. En **modo 3D** descarga los edificios del área visible, calcula sus
sombras (`geometry.js`) y determina para cada bar si su punto cae dentro de
alguna sombra → clasificación **real**. En **modo 2D** usa una heurística. Todo
es reactivo: mover el slider recalcula sombras y recolorea los bares al instante.

---

## 🌒 Cómo se calcula la sombra real (modo 3D)

Esta es la parte interesante. Un edificio es un prisma: un *footprint* (polígono
del suelo, de OSM) con una **altura** `h`. Con el sol a elevación `α` y azimut
`θ`:

1. La sombra se proyecta sobre el suelo en **dirección contraria al sol**, una
   longitud `L = h / tan(α)` (cuanto más bajo el sol, más larga la sombra).
2. El polígono de sombra es la **barrida** del footprint en esa dirección (suma
   de Minkowski con el segmento). Se aproxima con la envolvente convexa de
   `footprint ∪ footprint desplazado L`, exacta para edificios convexos.
3. Un bar está **en sombra** si su coordenada cae dentro del polígono de sombra
   de algún edificio (test punto-en-polígono, con poda por *bounding box*).

Todo el cálculo es en metros (proyección local equirectangular), suficiente a
escala de ciudad y **sin librerías externas**. Las sombras se dibujan como una
capa semitransparente sobre el suelo y, con la cámara inclinada, se ven bajo los
edificios extruidos.

**Optimizaciones de rendimiento:** la proyección y la envolvente convexa de cada
footprint se **precalculan una sola vez** al cargar los edificios (no en cada
movimiento del slider de hora), aprovechando que `hull(A ∪ A+v) = hull(hull(A) ∪
hull(A)+v)`. Para saber si un bar está en sombra se usa un **índice espacial
(grid uniforme)**, que reduce el coste de O(nº de sombras) por bar a O(candidatos
de la celda). Así mover la hora recalcula las sombras de miles de edificios al
instante.

**La altura** sale de OSM: `height` o `building:levels × 3 m`. Si un edificio no
declara altura, se asume ~9 m (3 plantas) y la UI indica cuántos edificios usan
ese valor por defecto.

### Categorías

- **☀️ Sol probable** · el bar no cae en ninguna sombra (modo 3D) o sol alto + terraza (modo 2D).
- **🌥️ Sombra probable** · cae en la sombra de un edificio (3D) o sol bajo (2D).
- **🌙 Sin sol (noche)** · el sol está bajo el horizonte.
- **⛅ Mixto** · solo en modo 2D, cuando la heurística no es concluyente.

---

## 🏛️ Alturas reales del Catastro (precisión de sombras)

El mayor problema de precisión es que muchos edificios de OSM no declaran altura.
CerveMap usa un **índice estático de alturas del Catastro español** (INSPIRE
Buildings) como fuente de respaldo. Prioridad de altura por edificio:

1. `height` o `building:levels` de **OSM** → `heightSource: 'osm'`.
2. **Catastro** (lookup por coordenada en el índice) → `heightSource: 'catastro'`.
3. Si no hay dato, **9 m** por defecto → `heightSource: 'fallback'`.

La UI muestra cuántos edificios usan altura real del Catastro.

### Regenerar el índice de alturas

El repo incluye un `public/data/seville-heights.json` **vacío** (la app funciona
sin él, con el fallback de 9 m). Para poblarlo con datos reales:

```bash
# 1. Descarga el GML de edificios de Sevilla (municipio 41091) del feed INSPIRE:
#    https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.BU.atom.xml
#    Descomprime el .zip -> A.ES.SDGC.BU.41091.building.gml
#
# 2. Genera el índice (grid ~50 m, altura = nº plantas × 3 m):
node scripts/build-heights.mjs ruta/al/A.ES.SDGC.BU.41091.building.gml
```

El script reproyecta de ETRS89/UTM (EPSG:25830) a WGS84 con `proj4` y escribe el
grid. Es un proceso **manual y offline**: el GML es grande y NO se versiona; el
resultado (`seville-heights.json`) sí se sirve como asset estático.

## ⚙️ Otras funciones

- **Caché IndexedDB:** los bares (24 h) y los edificios por zona (72 h) se
  cachean en el navegador. La segunda visita carga al instante; el panel indica
  "actualizado hace X" con botón **↻ Recargar**.
- **Abierto ahora:** el campo `opening_hours` de OSM se evalúa con la librería
  `opening_hours` a la hora del slider. Toggle "Solo abiertos ahora"; los bares
  confirmados cerrados se atenúan en el mapa.
- **Con terraza:** filtra por `outdoor_seating=yes` / `terrace=yes`.
- **Cerca de mí ☀️:** geolocaliza, centra el mapa y ordena una lista por
  **distancia (40 %) + sol (60 %)**, con distancia y minutos andando en el popup.
- **PWA:** instalable (`vite-plugin-pwa`), con assets y teselas base cacheados
  para uso offline. Aparece un banner "Instalar" en navegadores compatibles.

## Ejecutar en local

Requisitos: Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Build de producción:

```bash
npm run build
npm run preview
```

Test (geometría de sombras, sin red):

```bash
npm test
```

### Modo claro / oscuro

Botón 🌙/☀️ en la cabecera. **Por defecto arranca en modo claro** porque sobre un
mapa claro la sombra proyectada se ve con mucho más contraste; el modo oscuro
mantiene la estética nocturna. La preferencia se guarda en `localStorage`. En 3D,
las caras de los edificios se iluminan según la posición real del sol
(`map.setLight`).

---

## Desplegar en Vercel

1. Sube el repositorio a GitHub/GitLab.
2. En Vercel: **New Project → Import**.
3. Vercel detecta Vite automáticamente (`build` → `dist`).
4. Deploy. No hay variables de entorno ni secretos que configurar.

CLI: `npx vercel` (o `vercel --prod`).

---

## Limitaciones conocidas (honestas)

- **El modelo de sombra es 2.5D y geométrico:** usa la altura del bloque y un
  footprint convexo aproximado. No considera tejados inclinados, salientes,
  vegetación, toldos, ni la altura exacta del observador.
- **Depende de la altura en OSM:** muchos edificios no declaran `height` ni
  `building:levels`; ahí se asume ~9 m, lo que puede sobre/infraestimar la sombra.
- **Solo edificios del área visible** (a partir de cierto zoom) para no saturar
  el cálculo; los bares fuera de esa área usan la heurística 2D.
- **Completitud de OSM:** bares o edificios sin etiquetar no aparecen. El estado
  "abierto ahora" solo se puede calcular si el bar declara `opening_hours`; si no,
  se muestra "horario sin datos" y no se oculta al filtrar.
- **Alturas del Catastro:** se estiman como nº de plantas × 3 m (el Catastro no
  publica altura métrica generalizada). El índice versionado va vacío: regéneralo
  para activar las alturas reales (ver sección del Catastro).
- **Overpass API** puede ir lenta o limitar peticiones; se consultan **varios
  endpoints en paralelo** y se usa el primero que responde.
- La meteo de Open-Meteo es **previsión por hora** (~3 días), no observación.
- Los bares se cargan **por tiles del viewport** (no la ciudad entera de golpe):
  para ver zonas nuevas hay que mover/acercar el mapa. Por petición se cargan como
  mucho 16 tiles (los más cercanos al centro); el resto, al hacer pan/zoom.
- **Nominatim** limita a ~1 req/s. Se respeta con debounce y una sola petición
  activa. Nota: los navegadores **no permiten** fijar la cabecera `User-Agent`
  (la ignoran); Nominatim identifica la app por el `Referer` automático.
- El índice de alturas del Catastro solo cubre Sevilla; en otras ciudades los
  edificios sin altura en OSM usan el valor por defecto (~9 m).

## Mejoras futuras

- Unión exacta de polígonos de sombra (footprints cóncavos, edificios en L).
- Sombras GPU con deck.gl `SunLight` para mayor realismo visual.
- Otras ciudades con búsqueda de bounding box y su propio índice del Catastro.
- Carga diferida (`import()`) de `opening_hours` para aligerar el primer pintado.
- Ampliar la batería de tests (parseos de API, casos límite).

---

Datos de mapa, bares y edificios © colaboradores de
[OpenStreetMap](https://www.openstreetmap.org/copyright). Meteo por
[Open-Meteo](https://open-meteo.com/). Teselas por [CARTO](https://carto.com/).
Render por [MapLibre GL JS](https://maplibre.org/).
