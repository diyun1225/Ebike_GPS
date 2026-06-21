import { useState } from "react";
import { computeBaseline, targetHr, ZONE_RANGE } from "./decision.js";
import { useHeartRateEngine } from "./useHeartRateEngine.js";

// 出力情境按鈕（對應不同心率 / 呼吸，方便展示三種狀態）
const EFFORTS = [
  { id: "rest", label: "休息", icon: "🧘", value: 0.18 },
  { id: "cruise", label: "巡航", icon: "🚴", value: 0.45 },
  { id: "climb", label: "爬坡", icon: "⛰️", value: 0.7 },
  { id: "sprint", label: "衝刺", icon: "🔥", value: 0.92 },
];

// 進入畫面：先建立個人化基準線
function BaselineForm({ onStart }) {
  const [age, setAge] = useState(30);
  const [resting, setResting] = useState(60);
  const base = computeBaseline(+age || 0, +resting || 0);

  return (
    <div className="hr-setup">
      <h2>建立個人化基準線</h2>
      <p className="hr-setup-sub">最大心率 = 207 − (0.7 × 年齡)</p>

      <label>年齡</label>
      <input
        type="number"
        value={age}
        min="5"
        max="100"
        onChange={(e) => setAge(e.target.value)}
      />

      <label>安靜心跳（bpm）</label>
      <input
        type="number"
        value={resting}
        min="30"
        max="120"
        onChange={(e) => setResting(e.target.value)}
      />

      <div className="hr-baseline-preview">
        <div>
          <b>{base.maxHr}</b>
          <span>最大心率</span>
        </div>
        <div>
          <b>{base.hrr}</b>
          <span>儲備心率 HRR</span>
        </div>
      </div>

      <button className="hr-start" onClick={() => onStart(base)}>
        開始監測
      </button>
    </div>
  );
}

// 心率區間刻度條 + 目前指針
function ZoneBar({ base, live }) {
  // 30%~89% HRR 對應到刻度條
  const lo = 0.3;
  const hi = 0.89;
  const pos = Math.max(0, Math.min(1, (live.intensity - lo) / (hi - lo))) * 100;
  return (
    <div className="hr-zonebar">
      <div className="hr-zonebar-track">
        <span className="z z-low" style={{ flex: 0.39 - 0.3 }} />
        <span className="z z-high" style={{ flex: 0.59 - 0.4 }} />
        <span className="z z-max" style={{ flex: 0.89 - 0.6 }} />
        <span className="hr-zonebar-cursor" style={{ left: `${pos}%` }} />
      </div>
      <div className="hr-zonebar-lbls">
        <span>低</span>
        <span>中</span>
        <span>高</span>
      </div>
    </div>
  );
}

function Dashboard({ base, live, onEffort, onBack }) {
  const z = live.zone;
  const lowR = ZONE_RANGE[z.id];
  const targetText = `${targetHr(lowR[0], base)}–${targetHr(lowR[1], base)} bpm`;

  return (
    <>
      <button className="mode-back" onClick={onBack} aria-label="返回主畫面">
        ‹ 主畫面
      </button>

      {/* 車錶燈 + 心率大數字 */}
      <div className="hr-gauge" style={{ "--zc": z.color }}>
        <div className="hr-light" />
        <div className="hr-bpm">
          <b>{live.hr}</b>
          <span>bpm</span>
        </div>
        <div className="hr-zone-name">
          {z.label}・{z.name}（{z.light}）
        </div>
        <div className="hr-zone-target">目標 {targetText}</div>
      </div>

      {/* 目前狀態 */}
      <div className="hr-state" style={{ "--zc": z.color }}>
        <div className="hr-state-name">{live.state}</div>
        <div className="hr-state-note">{live.note}</div>
      </div>

      <ZoneBar base={base} live={live} />

      {/* 呼吸 + 馬達 */}
      <div className="hr-metrics">
        <div className="hr-metric">
          <span className="hr-metric-lbl">呼吸 RR</span>
          <b>{live.rr}</b>
          <span className="hr-metric-unit">次/分</span>
        </div>
        <div className="hr-metric">
          <span className="hr-metric-lbl">ΔRR / 5秒</span>
          <b>{live.dRR > 0 ? "+" : ""}{live.dRR}</b>
          <span className="hr-metric-unit">次</span>
        </div>
        <div className="hr-metric">
          <span className="hr-metric-lbl">馬達輸出</span>
          <b>{live.motorPct}<small>%</small></b>
          <span className="hr-metric-unit">{live.motor.label}</span>
        </div>
      </div>

      {/* 馬達輸出條 */}
      <div className="hr-motorbar">
        <div
          className="hr-motorbar-fill"
          style={{ width: `${live.motorPct}%`, background: z.color }}
        />
      </div>

      {/* 出力情境（模擬騎士狀態） */}
      <div className="hr-efforts">
        {EFFORTS.map((e) => (
          <button
            key={e.id}
            className={`hr-effort ${
              Math.abs(live.effort - e.value) < 0.06 ? "on" : ""
            }`}
            onClick={() => onEffort(e.value)}
          >
            <span className="hr-effort-icon">{e.icon}</span>
            {e.label}
          </button>
        ))}
      </div>
    </>
  );
}

export default function HeartRateMode({ onBack }) {
  const [base, setBase] = useState(null);
  const { live, setEffort } = useHeartRateEngine(base);

  return (
    <div className="dash hr">
      {!base && <BaselineForm onStart={setBase} />}
      {base && live && (
        <Dashboard base={base} live={live} onEffort={setEffort} onBack={onBack} />
      )}
    </div>
  );
}
