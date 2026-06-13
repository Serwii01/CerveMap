import { makeProjector, buildShadow, isInAnyShadow } from './src/lib/geometry.js';

const proj = makeProjector(37.389, -5.984);
const M = (x, y) => proj.toLngLat([x, y]); // metros -> lng/lat

// Edificio cuadrado de 20x20 m centrado en el origen, altura 20 m.
const ring = [M(-10, -10), M(10, -10), M(10, 10), M(-10, 10), M(-10, -10)];
const building = { id: 'test', ring, height: 20, assumed: false };

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  OK  ', name);
  } else {
    fail++;
    console.log('  FAIL', name);
  }
};

// Sol al ESTE (azimut 90), elevacion 45 -> L = 20/tan45 = 20 m hacia el OESTE.
{
  const sun = { isUp: true, azimuthDeg: 90, altitudeDeg: 45 };
  const sh = [buildShadow(building, sun, proj)];
  console.log('Sol al ESTE, 45°:');
  check('punto al OESTE (-20m) en sombra', isInAnyShadow(M(-20, 0), sh, proj));
  check('punto al ESTE (+20m) al sol', !isInAnyShadow(M(20, 0), sh, proj));
}

// Sol al OESTE (azimut 270), elevacion 45 -> sombra hacia el ESTE.
{
  const sun = { isUp: true, azimuthDeg: 270, altitudeDeg: 45 };
  const sh = [buildShadow(building, sun, proj)];
  console.log('Sol al OESTE, 45°:');
  check('punto al ESTE (+20m) en sombra', isInAnyShadow(M(20, 0), sh, proj));
  check('punto al OESTE (-20m) al sol', !isInAnyShadow(M(-20, 0), sh, proj));
}

// Sol al SUR (azimut 180), elevacion 45 -> sombra hacia el NORTE.
{
  const sun = { isUp: true, azimuthDeg: 180, altitudeDeg: 45 };
  const sh = [buildShadow(building, sun, proj)];
  console.log('Sol al SUR, 45°:');
  check('punto al NORTE (+20m) en sombra', isInAnyShadow(M(0, 20), sh, proj));
  check('punto al SUR (-20m) al sol', !isInAnyShadow(M(0, -20), sh, proj));
}

// Sol bajo (10°) -> sombra mas larga (~113 m). Punto a 80 m debe estar en sombra.
{
  const sun = { isUp: true, azimuthDeg: 90, altitudeDeg: 10 };
  const sh = [buildShadow(building, sun, proj)];
  const L = 20 / Math.tan((10 * Math.PI) / 180);
  console.log(`Sol bajo 10° (L≈${L.toFixed(0)}m):`);
  check('punto a 80m OESTE en sombra', isInAnyShadow(M(-80, 0), sh, proj));
  check('punto a 200m OESTE al sol (fuera)', !isInAnyShadow(M(-200, 0), sh, proj));
}

// Sol bajo el horizonte -> sin sombra.
{
  const sun = { isUp: false, azimuthDeg: 90, altitudeDeg: -5 };
  console.log('Sol bajo el horizonte:');
  check('buildShadow devuelve null', buildShadow(building, sun, proj) === null);
}

console.log(`\n=== ${pass} OK, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
