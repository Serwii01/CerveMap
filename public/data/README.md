# public/data

`seville-heights.json` es un **índice estático de alturas reales de edificios**
(Catastro español) que se consulta en runtime para dar altura a los edificios de
OSM que no la declaran. Se sirve como asset estático (sin backend).

El fichero versionado aquí es un **placeholder vacío** (`grid: {}`). La app
funciona igual sin él (cae al valor por defecto de 9 m), pero las sombras son más
precisas si lo regeneras con datos del Catastro:

```bash
# 1. Descarga el GML de edificios de Sevilla (municipio 41091) desde el feed INSPIRE:
#    https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.BU.atom.xml
#    Descomprime el .zip -> A.ES.SDGC.BU.41091.building.gml
#
# 2. Genera el índice:
node scripts/build-heights.mjs ruta/al/A.ES.SDGC.BU.41091.building.gml
```

Esto sobrescribe `seville-heights.json` con el grid real. Formato:

```json
{
  "source": "...", "generated": "YYYY-MM-DD",
  "cell": 0.0005,            // tamaño de celda en grados (~50 m)
  "buildings": 123456,        // edificios procesados
  "cells": 23456,             // celdas con dato
  "grid": { "ix:iy": 18 }     // clave floor(lng/cell):floor(lat/cell) -> altura en m
}
```
