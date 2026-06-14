/**
 * Genera public/data/seville-heights.json a partir de los edificios del
 * CATASTRO español (INSPIRE Buildings), para dar ALTURAS REALES a los edificios
 * que en OpenStreetMap no las declaran.
 *
 * Por qué: el mayor problema de precisión de las sombras es que muchos edificios
 * de OSM no tienen `height` ni `building:levels`, y se asumían 9 m. El Catastro
 * sí publica el nº de plantas de prácticamente todos los edificios de España.
 *
 * ── Cómo conseguir el GML ───────────────────────────────────────────────────
 * 1. Catálogo INSPIRE de edificios del Catastro:
 *      https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.BU.atom.xml
 *    (o la web https://www.catastro.meh.es/INSPIRE/buildings/)
 * 2. Descarga el feed de la provincia de Sevilla (41) y, dentro, el municipio
 *    de Sevilla (41091). Obtendrás un .zip con un fichero
 *      A.ES.SDGC.BU.41091.building.gml
 *    Descomprímelo en local (NO se sube al repo, es grande).
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/build-heights.mjs ruta/al/A.ES.SDGC.BU.41091.building.gml
 *   # opcional: varios ficheros, tamaño de celda y salida
 *   node scripts/build-heights.mjs *.building.gml --cell=0.0005 --out=public/data/seville-heights.json
 *
 * El resultado es un índice por celdas (~50 m) con la altura representativa
 * (mediana) de los edificios de cada celda. Se consulta en runtime por
 * coordenada (ver src/lib/heights.js). 100% estático, sin backend.
 *
 * Notas técnicas:
 *  - El Catastro entrega coordenadas en ETRS89 / UTM (EPSG:25829/25830/25831),
 *    proyectadas en metros. Se reproyectan a lon/lat (WGS84) con proj4.
 *  - La altura se estima como nº de plantas sobre rasante × 3 m (no hay altura
 *    métrica fiable y generalizada; las plantas sí están casi siempre).
 */
import fs from 'node:fs';
import path from 'node:path';
import sax from 'sax';
import proj4 from 'proj4';

// Definiciones de los husos UTM ETRS89 que usa el Catastro en España.
proj4.defs('EPSG:25829', '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:25831', '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const FLOOR_HEIGHT = 3; // metros por planta
const DEFAULT_CELL = 0.0005; // grados (~45-55 m a la latitud de Sevilla)
const DEFAULT_OUT = 'public/data/seville-heights.json';

// --- CLI ---
const args = process.argv.slice(2);
let cell = DEFAULT_CELL;
let out = DEFAULT_OUT;
const inputs = [];
for (const a of args) {
  if (a.startsWith('--cell=')) cell = parseFloat(a.slice(7));
  else if (a.startsWith('--out=')) out = a.slice(6);
  else inputs.push(a);
}
if (!inputs.length) {
  console.error('Uso: node scripts/build-heights.mjs <fichero.building.gml> [...] [--cell=0.0005] [--out=public/data/seville-heights.json]');
  process.exit(1);
}

function epsgFromSrs(srsName) {
  if (!srsName) return null;
  const m = String(srsName).match(/(\d{4,5})\s*$/);
  return m ? `EPSG:${m[1]}` : null;
}

// Acumula por celda las alturas (para luego sacar la mediana).
const cells = new Map();
const keyOf = (lng, lat) => `${Math.floor(lng / cell)}:${Math.floor(lat / cell)}`;

let totalFeatures = 0;

function parseGmlFile(file) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true }); // strict: conserva mayúsculas/prefijos
    let crs = null;

    // Estado de la "feature" en curso.
    let inFeature = false;
    let floors = null;
    let coords = null; // [sumX, sumY, n]
    let capturing = null; // 'floors' | 'pos' | null
    let buf = '';
    let posCaptured = false;

    const local = (name) => name.split(':').pop();

    parser.on('opentag', (node) => {
      const ln = local(node.name);
      if (!crs && node.attributes) {
        crs = epsgFromSrs(node.attributes.srsName || node.attributes.SRSNAME);
      }
      if (ln === 'Building' || ln === 'BuildingPart') {
        inFeature = true;
        floors = null;
        coords = null;
        posCaptured = false;
      } else if (inFeature && ln === 'numberOfFloorsAboveGround') {
        capturing = 'floors';
        buf = '';
      } else if (inFeature && !posCaptured && ln === 'posList') {
        capturing = 'pos';
        buf = '';
      }
    });

    parser.on('text', (t) => { if (capturing) buf += t; });
    parser.on('cdata', (t) => { if (capturing) buf += t; });

    parser.on('closetag', (name) => {
      const ln = local(name);
      if (capturing === 'floors' && ln === 'numberOfFloorsAboveGround') {
        const f = parseInt(buf, 10);
        if (Number.isFinite(f) && f > 0) floors = f;
        capturing = null;
      } else if (capturing === 'pos' && ln === 'posList') {
        const nums = buf.trim().split(/\s+/).map(Number);
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
            sx += nums[i]; sy += nums[i + 1]; n++;
          }
        }
        if (n) coords = [sx / n, sy / n];
        posCaptured = true;
        capturing = null;
      } else if (ln === 'Building' || ln === 'BuildingPart') {
        if (inFeature && floors && coords) {
          const epsg = crs || 'EPSG:25830';
          let lng, lat;
          try {
            [lng, lat] = proj4(epsg, 'EPSG:4326', coords);
          } catch {
            inFeature = false;
            return;
          }
          const k = keyOf(lng, lat);
          const h = floors * FLOOR_HEIGHT;
          const arr = cells.get(k);
          if (arr) arr.push(h); else cells.set(k, [h]);
          totalFeatures++;
        }
        inFeature = false;
        floors = null;
        coords = null;
      }
    });

    parser.on('error', reject);
    parser.on('end', resolve);
    fs.createReadStream(file).pipe(parser);
  });
}

function median(arr) {
  arr.sort((a, b) => a - b);
  const m = arr.length >> 1;
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}

const main = async () => {
  for (const file of inputs) {
    if (!fs.existsSync(file)) {
      console.error(`No existe: ${file}`);
      process.exit(1);
    }
    console.log(`Procesando ${file} …`);
    await parseGmlFile(file);
  }

  const grid = {};
  for (const [k, arr] of cells) grid[k] = Math.round(median(arr));

  const result = {
    source: 'Catastro INSPIRE Buildings (ES) · nº de plantas × 3 m',
    generated: new Date().toISOString().slice(0, 10),
    cell,
    buildings: totalFeatures,
    cells: cells.size,
    grid,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`✓ ${totalFeatures} edificios → ${cells.size} celdas → ${out} (${kb} KB)`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
