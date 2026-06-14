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
| Teselas base | **CARTO dark (OSM)** | Estética modo oscuro, sin clave. |
| Sol | **SunCalc** | Azimut/elevación calculados en el cliente, sin servidor. |
| Sombras | **Geometría propia** (`lib/geometry.js`) | Proyección real de sombras sin dependencias externas. |
| Meteo | **Open-Meteo** | Temperatura, nubosidad y código de cielo por hora, **sin API key**. |
| Bares y edificios | **Overpass API (OSM)** | Datos abiertos, sin backend ni clave. |
| Estilos | **CSS plano + variables** | Modo oscuro y responsive sin peso extra. |

**Por qué este stack:** es el camino más simple y sólido para desplegar en
Vercel sin servidor. MapLibre aporta el 3D y la extrusión de edificios con WebGL
sin claves, y todas las fuentes de datos son APIs públicas y gratuitas que se
consumen directamente desde el navegador. React mantiene el estado claro sin
sobreingeniería.

---

## Arquitectura

```
index.html
src/
  main.jsx              # punto de entrada
  App.jsx               # estado (hora, bares, edificios, sombras, meteo) + UI
  index.css             # tema oscuro, mobile-first, responsive
  components/
    MapView.jsx         # MapLibre: base, extrusión 3D, capa de sombras, bares, popups
    TimeControls.jsx    # slider de hora, fecha y botón "Ahora"
    SunCompass.jsx      # brújula SVG con azimut y elevación
  lib/
    overpass.js         # fetch de bares y de edificios (con fallback de endpoints)
    weather.js          # fetch + parseo de Open-Meteo
    sun.js              # posición solar (SunCalc) y utilidades
    classify.js         # heurística (2D) + clasificación por sombra real
    geometry.js         # proyección de sombras y tests punto/polígono
```

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
- **Completitud de OSM:** bares o edificios sin etiquetar no aparecen.
- **Overpass API** puede ir lenta o limitar peticiones; se consultan **varios
  endpoints en paralelo** y se usa el primero que responde.
- La meteo de Open-Meteo es **previsión por hora** (~3 días), no observación.
- El bounding box de bares cubre todo el municipio de Sevilla (incluido Sevilla
  Este, Bellavista, Macarena, San Jerónimo, Triana/Los Remedios…).

## Mejoras futuras

- Unión exacta de polígonos de sombra (footprints cóncavos, edificios en L).
- Sombras GPU con deck.gl `SunLight` para mayor realismo visual.
- Filtros: solo terrazas, solo al sol ahora, abiertos ahora.
- Geolocalización y orden de bares por cercanía + sol.
- Otras ciudades con búsqueda de bounding box.
- PWA/offline y caché de consultas Overpass.
- Ampliar la batería de tests (parseos de API, casos límite).

---

Datos de mapa, bares y edificios © colaboradores de
[OpenStreetMap](https://www.openstreetmap.org/copyright). Meteo por
[Open-Meteo](https://open-meteo.com/). Teselas por [CARTO](https://carto.com/).
Render por [MapLibre GL JS](https://maplibre.org/).
