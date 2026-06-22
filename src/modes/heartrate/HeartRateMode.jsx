import { useState } from "react";
import { computeBaseline } from "./decision.js";
import { useHeartRateEngine } from "./useHeartRateEngine.js";
import heartIcon from "../../assets/icon-heart.png";
import lungsIcon from "../../assets/icon-lungs.png";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 圓圈儀表：環形進度 + 中央會「呼吸/跳動」的 icon + 數值
function RingGauge({ value, min, max, color, icon, beatDur, num, unit, sub }) {
  const cx = 80;
  const cy = 80;
  const r = 64;
  const C = 2 * Math.PI * r;
  const frac = clamp((value - min) / (max - min), 0, 1);
  return (
    <div className="hr-ring" style={{ "--rc": color }}>
      <svg viewBox="0 0 160 160" className="hr-ring-svg">
        <circle cx={cx} cy={cy} r={r} className="hr-ring-track" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          className="hr-ring-arc"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }}
        />
      </svg>
      <div className="hr-ring-center">
        <span className="hr-ring-icon" style={{ animationDuration: beatDur }}>
          {icon}
        </span>
        <b className="hr-ring-num">{num}</b>
        <span className="hr-ring-unit">{unit}</span>
        <span className="hr-ring-sub">{sub}</span>
      </div>
    </div>
  );
}

// 輔助力檔位：階梯式分段（像排檔）
function GearBar({ pct, label, color }) {
  const total = 5;
  const on = clamp(Math.round(pct / (100 / total)), 0, total);
  return (
    <div className="hr-gear">
      <div className="hr-gear-head">
        <span>輔助力檔位</span>
        <b>
          {label} · {pct}%
        </b>
      </div>
      <div className="hr-gear-bars">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`hr-gear-seg ${i < on ? "on" : ""}`}
            style={{
              height: `${40 + i * 15}%`,
              ...(i < on ? { background: color } : null),
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Demo 情境：直接對應三種燈號狀態（值≈%HRR 強度）
const EFFORTS = [
  { id: "low", label: "狀態A", value: 0.33 }, // 藍燈 HR_LOW
  { id: "high", label: "狀態B", value: 0.5 }, // 綠燈 HR_HIGH
  { id: "max", label: "狀態C", value: 0.75 }, // 橘燈 HR_MAX
];

// 進入畫面：先建立個人化基準線
function BaselineForm({ onStart }) {
  const [age, setAge] = useState(30);
  const [resting, setResting] = useState(60);
  const [confirming, setConfirming] = useState(false); // 確認視窗
  const base = computeBaseline(+age || 0, +resting || 0);

  return (
    <div className="hr-setup">
      <h2>建立個人化基準線</h2>

      {/* 年齡 + 安靜心跳，同一列 */}
      <div className="hr-setup-row">
        <div className="hr-field">
          <label>年齡</label>
          <input
            type="number"
            value={age}
            min="5"
            max="100"
            onChange={(e) => setAge(e.target.value)}
          />
        </div>
        <div className="hr-field">
          <label>安靜心跳（bpm）</label>
          <input
            type="number"
            value={resting}
            min="30"
            max="120"
            onChange={(e) => setResting(e.target.value)}
          />
        </div>
      </div>

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

      <button className="hr-start" onClick={() => setConfirming(true)}>
        開始監測
      </button>

      {confirming && (
        <div className="hr-modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-icon">❤️</div>
            <h3>確定設定完成？</h3>
            <div className="hr-modal-rows">
              <div>
                <span>年齡</span>
                <b>{age}</b>
              </div>
              <div>
                <span>安靜心跳</span>
                <b>{resting}</b>
              </div>
            </div>
            <div className="hr-modal-actions">
              <button
                className="hr-modal-cancel"
                onClick={() => setConfirming(false)}
              >
                再修改
              </button>
              <button className="hr-modal-ok" onClick={() => onStart(base)}>
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 心率區間刻度條 + 目前指針
function ZoneBar({ live }) {
  // 30%~89% HRR 對應到刻度條
  const lo = 0.3;
  const hi = 0.89;
  const pos = Math.max(0, Math.min(1, (live.intensity - lo) / (hi - lo))) * 100;
  return (
    <div className="hr-zonebar">
      <div className="hr-zonebar-title">心率強度區間</div>
      <div className="hr-zonebar-track">
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

function Dashboard({ base, live, onEffort }) {
  const z = live.zone;
  // 愛心跳動週期＝60/心率（越快跳越快）；呼吸 icon 週期＝60/呼吸率
  const beatDur = `${(60 / clamp(live.hr, 40, 200)).toFixed(2)}s`;
  const breathDur = `${(60 / clamp(live.rr, 6, 40)).toFixed(2)}s`;

  return (
    <>
      {/* 狀態（規格 A/B/C）在上、狀態名稱在下 */}
      <div className="hr-zonepill" style={{ "--zc": z.color }}>
        <span className="hr-zonepill-abc">狀態{z.abc}</span>
        <span className="hr-zonepill-name">{live.state}</span>
      </div>

      {/* 兩大生理訊號圓圈儀表 */}
      <div className="hr-rings">
        <RingGauge
          value={live.hr}
          min={base.restingHr}
          max={base.maxHr}
          color={z.color}
          icon={<img className="hr-ring-img" src={heartIcon} alt="" />}
          beatDur={beatDur}
          num={live.hr}
          unit="bpm"
          sub="心率"
        />
        <RingGauge
          value={live.rr}
          min={8}
          max={40}
          color="#2f93b5"
          icon={<img className="hr-ring-img" src={lungsIcon} alt="" />}
          beatDur={breathDur}
          num={live.rr}
          unit="次/分"
          sub="呼吸率"
        />
      </div>

      <ZoneBar live={live} />

      {/* 輔助力檔位 */}
      <GearBar pct={live.motorPct} label={live.motor.label} color={z.color} />

      {/* Demo：模擬不同騎乘強度，方便展示三種燈號狀態（非正式功能） */}
      <div className="hr-demo">
        <div className="hr-demo-label">Demo模擬不同強度</div>
        <div className="hr-efforts">
          {EFFORTS.map((e) => (
            <button
              key={e.id}
              className={`hr-effort ${
                Math.abs(live.effort - e.value) < 0.06 ? "on" : ""
              }`}
              onClick={() => onEffort(e.value)}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function HeartRateMode({ onBack }) {
  const [base, setBase] = useState(null);
  const [confirmExit, setConfirmExit] = useState(false); // 返回確認視窗
  const { live, setEffort } = useHeartRateEngine(base);

  return (
    <div
      className="dash hr"
      style={{ "--zc": live?.zone?.color || "#ff8aa3" }}
    >
      <button
        className="mode-back"
        onClick={() => setConfirmExit(true)}
        aria-label="返回主畫面"
      >
        ‹ 主畫面
      </button>

      {!base && <BaselineForm onStart={setBase} />}
      {base && live && (
        <Dashboard base={base} live={live} onEffort={setEffort} />
      )}

      <h1 className="hr-header">心率模式</h1>

      {confirmExit && (
        <div className="hr-modal-backdrop" onClick={() => setConfirmExit(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-icon">🚪</div>
            <h3>確定要離開心率模式？</h3>
            <div className="hr-modal-actions">
              <button
                className="hr-modal-cancel"
                onClick={() => setConfirmExit(false)}
              >
                取消
              </button>
              <button className="hr-modal-ok" onClick={onBack}>
                離開
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
