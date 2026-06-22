// 半圓時速表：漸層弧 + 刻度 + 指針（指針/弧長都有 CSS 過場所以很順）
export default function Speedometer({ speed = 0, max = 25 }) {
  const cx = 100;
  const cy = 100;
  const r = 80;
  const frac = Math.max(0, Math.min(1, speed / max));

  // 上半圓弧（左→右）
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  // 刻度：左(180°)→右(0°)平均 11 格，每 5 格一條長刻度
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = ((180 - i * 18) * Math.PI) / 180;
    const ri = r - (i % 5 === 0 ? 17 : 13);
    const ro = r - 6;
    return {
      x1: cx + ri * Math.cos(a),
      y1: cy - ri * Math.sin(a),
      x2: cx + ro * Math.cos(a),
      y2: cy - ro * Math.sin(a),
      maj: i % 5 === 0,
    };
  });

  return (
    <svg className="gauge" viewBox="0 0 200 120">
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff9a8b" />
          <stop offset="55%" stopColor="#f23b3b" />
          <stop offset="100%" stopColor="#c1121f" />
        </linearGradient>
      </defs>

      <path d={arc} className="gauge-bg" />

      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          className={`gauge-tick ${t.maj ? "maj" : ""}`}
        />
      ))}

      <path
        d={arc}
        className="gauge-fg"
        pathLength="100"
        style={{ strokeDasharray: 100, strokeDashoffset: 100 - frac * 100 }}
      />

      <text x={cx} y={cy - 22} className="gauge-num" textAnchor="middle">
        {Math.round(speed)}
      </text>
      <text x={cx} y={cy - 6} className="gauge-unit" textAnchor="middle">
        km/h
      </text>
    </svg>
  );
}
