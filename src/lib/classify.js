/**
 * Heuristica HONESTA de sol/sombra.
 *
 * Limitacion importante: no modelamos la sombra real proyectada por edificios
 * ni la orientacion exacta de cada terraza, porque OpenStreetMap no aporta
 * geometria 3D fiable de forma generalizada. Por eso la clasificacion se basa
 * en datos verificables:
 *   1. Si el sol esta por encima del horizonte y a que altura.
 *   2. Si el bar declara terraza (outdoor_seating) en OSM.
 *
 * Devolvemos siempre una categoria + una nota de confianza para no enganar.
 */

export const CATEGORY = {
  SUN: 'sol',
  MIXED: 'mixto',
  SHADE: 'sombra',
  NIGHT: 'noche',
};

export const CATEGORY_META = {
  [CATEGORY.SUN]: { label: 'Sol probable', color: '#f5a524', emoji: '☀️' },
  [CATEGORY.MIXED]: { label: 'Mixto', color: '#7aa2f7', emoji: '⛅' },
  [CATEGORY.SHADE]: { label: 'Sombra probable', color: '#5b6172', emoji: '🌥️' },
  [CATEGORY.NIGHT]: { label: 'Sin sol (noche)', color: '#3b4252', emoji: '🌙' },
};

/**
 * @param {object} sun  resultado de getSunPosition
 * @param {object} bar  bar con tags de OSM
 * @returns {{category, label, note}}
 */
export function classifyBar(sun, bar) {
  const hasTerrace = bar.outdoorSeating === 'yes';
  const terraceUnknown = !bar.outdoorSeating;

  // De noche no hay sol directo en ningun sitio.
  if (!sun.isUp) {
    return {
      category: CATEGORY.NIGHT,
      ...CATEGORY_META[CATEGORY.NIGHT],
      note: 'El sol esta bajo el horizonte a esta hora.',
    };
  }

  // Sol muy bajo: luz rasante, mucha sombra de edificios. Mixto/sombra.
  if (sun.altitudeDeg < 8) {
    return {
      category: CATEGORY.SHADE,
      ...CATEGORY_META[CATEGORY.SHADE],
      note: 'Sol muy bajo: las calles de Sevilla suelen quedar en sombra.',
    };
  }

  // Sol medio: depende mucho de la calle. Lo marcamos como mixto.
  if (sun.altitudeDeg < 25) {
    return {
      category: CATEGORY.MIXED,
      ...CATEGORY_META[CATEGORY.MIXED],
      note: hasTerrace
        ? 'Terraza declarada, pero el sol medio puede quedar tapado por edificios.'
        : 'Altura solar media: probabilidad mixta de sol.',
    };
  }

  // Sol alto: alta probabilidad de sol en zonas abiertas / terrazas.
  if (hasTerrace) {
    return {
      category: CATEGORY.SUN,
      ...CATEGORY_META[CATEGORY.SUN],
      note: 'Sol alto y terraza declarada en OSM.',
    };
  }
  return {
    category: CATEGORY.MIXED,
    ...CATEGORY_META[CATEGORY.MIXED],
    note: terraceUnknown
      ? 'Sol alto, pero no consta terraza en OSM (datos incompletos).'
      : 'Sol alto, sin terraza declarada.',
  };
}

/**
 * Clasificacion con SOMBRA REAL calculada a partir de la geometria de los
 * edificios (ver lib/geometry.js). Mas fiable que la heuristica.
 * @param {object} sun
 * @param {boolean} inShadow  true si el punto cae en la sombra de un edificio
 */
export function classifyByShadow(sun, inShadow) {
  if (!sun.isUp) {
    return {
      category: CATEGORY.NIGHT,
      ...CATEGORY_META[CATEGORY.NIGHT],
      note: 'El sol esta bajo el horizonte a esta hora.',
    };
  }
  if (inShadow) {
    return {
      category: CATEGORY.SHADE,
      ...CATEGORY_META[CATEGORY.SHADE],
      note: 'En la sombra proyectada por un edificio cercano (cálculo geométrico).',
    };
  }
  return {
    category: CATEGORY.SUN,
    ...CATEGORY_META[CATEGORY.SUN],
    note: 'Al sol según el cálculo de sombras de los edificios cercanos.',
  };
}
