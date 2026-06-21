// 半圓時速表（指針用 transform 旋轉，有 CSS 過場所以很順）
export default function Speedometer({ speed = 0, max = 40 }) {
  const cx = 100;
  const cy = 100;
  const r = 80;
  const r2 = 66;
  const frac = Math.max(0, Math.min(1, speed / max));
  const rot = (frac - 0.5) * 180; // -90(左) ~ 0(上) ~ +90(右)

  // 上半圓弧（左→右）
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <svg className="gauge" viewBox="0 0 200 116">
      <path d={arc} className="gauge-bg" />
      <path
        d={arc}
        className="gauge-fg"
        pathLength="100"
        style={{ strokeDasharray: 100, strokeDashoffset: 100 - frac * 100 }}
      />
      <line
        x1={cx}
        y1={cy}
        x2={cx}
        y2={cy - r2}
        className="gauge-needle"
        transform={`rotate(${rot} ${cx} ${cy})`}
      />
      <circle cx={cx} cy={cy} r="6" className="gauge-hub" />
      <text x={cx} y={cy - 22} className="gauge-num" textAnchor="middle">
        {Math.round(speed)}
      </text>
      <text x={cx} y={cy - 6} className="gauge-unit" textAnchor="middle">
        km/h
      </text>
    </svg>
  );
}
