/**
 * Control de hora: slider 0-24h sobre el dia seleccionado + boton "Ahora".
 */
export default function TimeControls({ date, onChange }) {
  const minutes = date.getHours() * 60 + date.getMinutes();

  const setMinutes = (m) => {
    const d = new Date(date);
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    onChange(d);
  };

  const setNow = () => onChange(new Date());

  const setDay = (e) => {
    const [y, mo, da] = e.target.value.split('-').map(Number);
    const d = new Date(date);
    d.setFullYear(y, mo - 1, da);
    onChange(d);
  };

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const dayValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;

  return (
    <div className="time-controls">
      <div className="time-row">
        <input
          type="date"
          value={dayValue}
          onChange={setDay}
          aria-label="Fecha"
          className="date-input"
        />
        <div className="time-display" aria-live="polite">
          {hh}:{mm}
        </div>
        <button className="now-btn" onClick={setNow} type="button">
          Ahora
        </button>
      </div>
      <input
        type="range"
        min="0"
        max="1439"
        step="5"
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        aria-label="Hora del día"
        className="time-slider"
      />
      <div className="slider-scale" aria-hidden="true">
        <span>00h</span>
        <span>06h</span>
        <span>12h</span>
        <span>18h</span>
        <span>24h</span>
      </div>
    </div>
  );
}
