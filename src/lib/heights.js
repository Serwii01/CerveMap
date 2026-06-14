/**
 * Índice estático de ALTURAS REALES de edificios (Catastro), consultado por
 * coordenada. Se carga una sola vez (lazy) desde /data/seville-heights.json,
 * generado por scripts/build-heights.mjs. Si no existe o está vacío, la app
 * sigue funcionando con el fallback de 9 m.
 */
let promise = null;
let index = null; // { cell, grid, source, generated, buildings, cells }

const url = () => `${import.meta.env.BASE_URL || '/'}data/seville-heights.json`;

/** Carga el índice una vez. Tolera ausencia/errores devolviendo null. */
export function loadHeights() {
  if (!promise) {
    promise = fetch(url())
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        index = d && d.grid && d.cell ? d : null;
        return index;
      })
      .catch(() => {
        index = null;
        return null;
      });
  }
  return promise;
}

/** Altura (m) del Catastro para una coordenada, o null si no hay dato. */
export function lookupHeight(lat, lng) {
  if (!index) return null;
  const c = index.cell;
  const h = index.grid[`${Math.floor(lng / c)}:${Math.floor(lat / c)}`];
  return typeof h === 'number' && h > 0 ? h : null;
}

/** Metadatos del índice cargado (para la UI), o null si no hay índice útil. */
export function heightsMeta() {
  if (!index) return null;
  const cells = index.cells ?? Object.keys(index.grid).length;
  return cells > 0
    ? { cells, buildings: index.buildings, generated: index.generated }
    : null;
}
