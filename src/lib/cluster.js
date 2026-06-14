/**
 * Clustering de bares con supercluster. Agrega además, por cluster, cuántos
 * bares están al sol y cuántos en sombra para poder colorearlos según la mayoría.
 */
import Supercluster from 'supercluster';

// Colores de cluster según la mayoría sol/sombra.
export const CLUSTER_COLORS = {
  sun: '#f5a524', // >60% al sol
  shade: '#5b6172', // >60% en sombra
  mixed: '#e0c23c', // mezcla
};

/**
 * Crea el índice a partir de features GeoJSON de bares. Cada feature debe llevar
 * `properties.cat` ('sol' | 'sombra' | 'mixto' | 'noche').
 */
export function buildClusterIndex(features) {
  const index = new Supercluster({
    radius: 60,
    maxZoom: 16,
    minZoom: 0,
    map: (props) => ({
      sun: props.cat === 'sol' ? 1 : 0,
      shade: props.cat === 'sombra' ? 1 : 0,
    }),
    reduce: (acc, props) => {
      acc.sun += props.sun;
      acc.shade += props.shade;
    },
  });
  index.load(features);
  return index;
}

/** Color del cluster según la mayoría (>60%). */
export function clusterColor(sun, shade, count) {
  if (count > 0 && sun / count > 0.6) return CLUSTER_COLORS.sun;
  if (count > 0 && shade / count > 0.6) return CLUSTER_COLORS.shade;
  return CLUSTER_COLORS.mixed;
}

/**
 * Devuelve { clusters, points } para los límites [w,s,e,n] y el zoom dados.
 * A cada cluster le añade `clusterColor` para pintarlo directamente.
 */
export function queryClusters(index, bounds, zoom) {
  const feats = index.getClusters(bounds, Math.round(zoom));
  const clusters = [];
  const points = [];
  for (const f of feats) {
    if (f.properties.cluster) {
      const { point_count, sun = 0, shade = 0 } = f.properties;
      f.properties.clusterColor = clusterColor(sun, shade, point_count);
      clusters.push(f);
    } else {
      points.push(f);
    }
  }
  return { clusters, points };
}
