/**
 * Web Worker que calcula las sombras de los edificios y el estado sol/sombra de
 * cada bar fuera del hilo principal, para que mover el slider de hora no bloquee
 * la UI.
 *
 * Protocolo:
 *  - { type:'setBuildings', origin:[lat,lng], buildings:[{ring,height}] }
 *      Prepara y cachea los edificios (proyección + envolvente) una sola vez.
 *  - { type:'compute', reqId, sun, coords:Float64Array }
 *      Responde { reqId, states:Uint8Array, rings } y TRANSFIERE states.buffer
 *      (sin copia) de vuelta al hilo principal.
 */
import { prepareBuilding, makeProjector, computeShadowData } from '../lib/geometry.js';

let prepared = [];
let origin = [0, 0];

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'setBuildings') {
    origin = msg.origin;
    const proj = makeProjector(origin[0], origin[1]);
    prepared = msg.buildings.map((b) => prepareBuilding(b, proj));
    return;
  }
  if (msg.type === 'compute') {
    const { reqId, sun, coords } = msg;
    const { states, rings } = computeShadowData(prepared, sun, coords, origin);
    // states.buffer se transfiere (transferable); rings va por structured clone.
    self.postMessage({ reqId, states, rings }, [states.buffer]);
  }
};
