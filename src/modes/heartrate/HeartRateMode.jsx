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

// 輔助力段數：階梯式分段（像排檔）。gear 1~5，6=無輔助
function GearBar({ gear, color }) {
  const total = 5;
  const isNone = gear === 6;
  const on = isNone ? 0 : clamp(gear, 0, total);
  return (
    <div className="hr-gear">
      <div className="hr-gear-head">
        <span>輔助力段數</span>
        <b style={{ color }}>{isNone ? "無輔助" : `${gear} 段`}</b>
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

// 目前疲勞度：0~100 的進度條，依高低換色與文字
function FatigueBar({ value }) {
  const pct = clamp(Math.round(value ?? 0), 0, 100);
  const color = pct < 40 ? "#3bb27a" : pct < 70 ? "#e0a92e" : "#e14b5a";
  const label = pct < 40 ? "良好" : pct < 70 ? "偏高" : "疲勞";
  return (
    <div className="hr-fatigue">
      <div className="hr-fatigue-head">
        <span>目前疲勞度</span>
        <b style={{ color }}>
          {pct}%・{label}
        </b>
      </div>
      <div className="hr-fatigue-track">
        <div
          className="hr-fatigue-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

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

function Dashboard({ base, live }) {
  const z = live.zone;
  // 愛心跳動週期＝60/心率（越快跳越快）；呼吸 icon 週期＝60/呼吸率
  const beatDur = `${(60 / clamp(live.hr, 40, 200)).toFixed(2)}s`;
  const breathDur = `${(60 / clamp(live.rr, 6, 40)).toFixed(2)}s`;

  return (
    <>
      {/* 狀態（規格 A/B/C）在上、狀態名稱在下 */}
      <div className="hr-zonepill" style={{ "--zc": z.color }}>
        <span className="hr-zonepill-abc">狀態{z.abc}</span>
        <span className="hr-zonepill-name">{z.name}</span>
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

      {/* 目前疲勞度 */}
      <FatigueBar value={live.fatigue} />

      {/* 輔助力段數 */}
      <GearBar gear={live.gear} color={z.color} />
    </>
  );
}

export default function HeartRateMode({ onBack }) {
  const [base, setBase] = useState(null);
  const [confirmExit, setConfirmExit] = useState(false); // 返回確認視窗
  const { live } = useHeartRateEngine(base);

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
      {base && live && <Dashboard base={base} live={live} />}

      {confirmExit && (
        <div className="hr-modal-backdrop" onClick={() => setConfirmExit(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-icon">🚪</div>
            <h3>確定要離開心肺模式？</h3>
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
