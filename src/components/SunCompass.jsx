import { azimuthToCardinal } from '../lib/sun.js';

/**
 * Brujula SVG que muestra la direccion (azimut) y la elevacion del sol.
 * Si el sol esta bajo el horizonte, se atenua.
 */
export default function SunCompass({ sun }) {
  const size = 132;
  const c = size / 2;
  const r = c - 16;

  // Azimut de brujula -> angulo SVG. 0deg = arriba (Norte). En SVG el angulo 0
  // apunta a la derecha, asi que restamos 90 y convertimos a radianes.
  const rad = ((sun.azimuthDeg - 90) * Math.PI) / 180;
  const x = c + r * Math.cos(rad);
  const y = c + r * Math.sin(rad);

  return (
    <div className="compass">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Sol al ${azimuthToCardinal(sun.azimuthDeg)}, ${Math.round(
          sun.altitudeDeg,
        )} grados de elevacion`}
      >
        <circle cx={c} cy={c} r={r} className="compass-ring" />
        {['N', 'E', 'S', 'O'].map((d, i) => {
          const a = ((i * 90 - 90) * Math.PI) / 180;
          return (
            <text
              key={d}
              x={c + (r + 9) * Math.cos(a)}
              y={c + (r + 9) * Math.sin(a) + 4}
              className="compass-card"
              textAnchor="middle"
            >
              {d}
            </text>
          );
        })}
        <line
          x1={c}
          y1={c}
          x2={x}
          y2={y}
          className="compass-needle"
          opacity={sun.isUp ? 1 : 0.3}
        />
        <circle
          cx={x}
          cy={y}
          r={sun.isUp ? 9 : 6}
          className="compass-sun"
          opacity={sun.isUp ? 1 : 0.3}
        />
        <text x={c} y={c + 4} textAnchor="middle" className="compass-center">
          {Math.round(sun.altitudeDeg)}°
        </text>
      </svg>
      <div className="compass-meta">
        <div>
          <span className="muted">Azimut</span>
          <strong>
            {Math.round(sun.azimuthDeg)}° {azimuthToCardinal(sun.azimuthDeg)}
          </strong>
        </div>
        <div>
          <span className="muted">Elevación</span>
          <strong>{Math.round(sun.altitudeDeg)}°</strong>
        </div>
      </div>
    </div>
  );
}
