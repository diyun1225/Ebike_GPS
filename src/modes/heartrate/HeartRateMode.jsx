import { useEffect, useRef, useState } from "react";
import { computeBaseline } from "./decision.js";
import { useHeartRateEngine } from "./useHeartRateEngine.js";
import { useBle } from "../../ble/BleContext.jsx";
import heartIcon from "../../assets/icon-heart.png";
import lungsIcon from "../../assets/icon-lungs.png";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 沒有數值時統一顯示破折號
const fmt = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);

// 車輛數據（車速為主 + 踏頻/電量/馬達溫度）。數值來自共用 BLE telemetry，
// 沒連線時顯示「—」。連線在主畫面做，這裡只讀資料。
function TeleGrid({ data }) {
  const d = data || {};
  return (
    <div className="hr-tele">
      <div className="hr-tele-speed">
        <b>{fmt(d.speedKph, 1)}</b>
        <span>km/h・車速</span>
      </div>
      <div className="hr-tele-grid">
        <div className="hr-tele-card">
          <span className="hr-tele-label">踏頻</span>
          <b className="hr-tele-value">{fmt(d.cadenceRpm)}<small> rpm</small></b>
        </div>
        <div className="hr-tele-card">
          <span className="hr-tele-label">電池電量</span>
          <b className="hr-tele-value">
            {d.batterySocPct == null ? "—" : `${d.batterySocPct}%`}
          </b>
        </div>
      </div>
    </div>
  );
}

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

// 輔助力段數對應的模式名稱：index = 段位，0=Off
const ASSIST_LABELS = ["Off", "Eco", "Eco+", "Normal", "Sport", "Sport+"];

// Demo 可直接指定的強度（band 對應引擎的 DEMO_BANDS index）
const DEMO_OPTS = [
  { band: 0, label: "低強度" },
  { band: 1, label: "中強度" },
  { band: 2, label: "高強度" },
];

// 輔助力段數：階梯式分段（像排檔）。gear 1~5，6=無輔助（顯示為 0 Off）；
// gear=null（真實資料模式還沒收到心率）→ 顯示「—」、不亮任何格。
function GearBar({ gear, color }) {
  const total = 5;
  const level = gear === 6 ? 0 : clamp(gear ?? 0, 0, total); // 6=無輔助 → 顯示 0
  const on = gear == null ? 0 : level;
  return (
    <div className="hr-gear">
      <div className="hr-gear-head">
        <span>輔助力段數</span>
        <b style={{ color }}>
          {gear == null ? "—" : `${level}：${ASSIST_LABELS[level]}`}
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

// 真實資料模式還沒收到心率時 zone 為 null → 用中性灰當佔位，數值顯示「—」
const ZONE_PLACEHOLDER = { name: "—", color: "#9aa7a0" };

function Dashboard({ base, live, data }) {
  const z = live.zone || ZONE_PLACEHOLDER;
  const noData = live.hr == null;
  // 愛心跳動週期＝60/心率（越快跳越快）；呼吸 icon 週期＝60/呼吸率；無數據不動畫
  const beatDur = noData ? undefined : `${(60 / clamp(live.hr, 40, 200)).toFixed(2)}s`;
  const breathDur = live.rr == null ? undefined : `${(60 / clamp(live.rr, 6, 40)).toFixed(2)}s`;

  return (
    <>
      {/* 強度區間名稱（低/中/高強度），沿用原狀態膠囊樣式並放大 */}
      <div className="hr-zonepill" style={{ "--zc": z.color }}>
        <span className="hr-zonepill-name">{z.name}</span>
      </div>

      {/* 資料來源標示：引擎當下吃「真實感測」還是「模擬」。
          顯示「模擬」= 引擎沒收到 hr（毫米波沒進來/走錯連線/開著 Demo），一眼可判斷。 */}
      <div className={`hr-src ${live.real ? "real" : "sim"}`}>
        {live.real
          ? "● 真實感測"
          : live.waiting
          ? "○ 等待毫米波心率（未收到前顯示 —）"
          : "○ 模擬資料（未收到心率）"}
      </div>

      {/* 兩大生理訊號圓圈儀表 */}
      <div className="hr-rings">
        <RingGauge
          value={live.hr ?? base.restingHr}
          min={base.restingHr}
          max={base.maxHr}
          color={z.color}
          icon={<img className="hr-ring-img" src={heartIcon} alt="" />}
          beatDur={beatDur}
          num={fmt(live.hr)}
          unit="bpm"
          sub="心率"
        />
        <RingGauge
          value={live.rr ?? 8}
          min={8}
          max={40}
          color="#2f93b5"
          icon={<img className="hr-ring-img" src={lungsIcon} alt="" />}
          beatDur={breathDur}
          num={fmt(live.rr)}
          unit="次/分"
          sub="呼吸率"
        />
      </div>

      {/* 輔助力段數 */}
      <GearBar gear={live.gear} color={z.color} />

      {/* 車輛數據（共用 BLE telemetry） */}
      <TeleGrid data={data} />
    </>
  );
}

export default function HeartRateMode({ onBack }) {
  const [base, setBase] = useState(null);
  const [confirmExit, setConfirmExit] = useState(false); // 返回確認視窗
  const [demoBand, setDemoBand] = useState(null); // null=關、-1=隨機、0/1/2=低/中/高
  const [demoOpen, setDemoOpen] = useState(false); // demo 面板是否展開
  // 只用真實資料：開啟後沒收到毫米波心率就顯示等待畫面，絕不跑模擬曲線
  const [realOnly, setRealOnly] = useState(false);
  // data=自行車車況；vitals=生理量測（毫米波 hr/rr/fi，走 CAN 0x1FA15000 或同條 TX 的 JSON）
  const { data, vitals, phase, canControl, isDemo, setAssist } = useBle();
  // 引擎優先吃真實 hr/rr/fi（非 demo 且有值時）；沒有就依 realOnly 決定等待或模擬
  const { live } = useHeartRateEngine(base, demoBand, vitals, realOnly);

  // ⛔ 心肺模式自動控制輔助力：暫時停用（整段註解，不對真車送任何 ASSIST 指令）。
  // 停用原因：這段只檢查 isDemo/phase/canControl，沒檢查 live.real——
  // 毫米波沒接上時引擎會退回「模擬心率曲線」，等於用假資料反覆改真車段位。
  // 要重新啟用：把下面整段解開，並在條件加上 `!live?.real` 就 return（只有真實
  // 生理資料才允許控車）。畫面上的段數條不受影響，照常顯示引擎決策結果。
  //
  //   指令＝ "ASSIST,<0-5>"（走 ble.setAssist → 韌體 control_set_assist_level，收 0~5），
  //   與 BLE/ble_phone.html 的助力按鈕同一條路徑。段位 6（無輔助）對應 0（off）。
  // 只在「連到真車、可控制、非模擬」且段位有變動時才送，避免每 0.5 秒洗爆 BLE。
  // const lastAssistRef = useRef(null);
  // useEffect(() => {
  //   if (isDemo || phase !== "connected" || !canControl) {
  //     lastAssistRef.current = null; // 斷線/模擬：清掉，之後重連第一筒仍會送
  //     return;
  //   }
  //   if (live?.gear == null) return;
  //   const level = live.gear === 6 ? 0 : clamp(live.gear, 0, 5);
  //   if (level === lastAssistRef.current) return;
  //   lastAssistRef.current = level;
  //   setAssist(level);
  // }, [live?.gear, isDemo, phase, canControl, setAssist]);

  // 選 demo 強度：沒設基準線時先套預設值，再套用選到的強度（同時關掉「只用真實」）
  const pickDemo = (band) => {
    if (band != null && !base) setBase(computeBaseline(30, 60));
    setDemoBand(band);
    if (band != null) setRealOnly(false); // demo 與「只用真實」互斥
    setDemoOpen(false);
  };
  // 只用真實資料：關 demo、開 realOnly（沒收到心率就等待，不模擬）
  const pickRealOnly = () => {
    setDemoBand(null);
    setRealOnly(true);
    setDemoOpen(false);
  };
  const demoLabel = realOnly
    ? "真實資料"
    : demoBand == null
    ? "Demo"
    : demoBand === -1
    ? "Demo・隨機"
    : `Demo・${DEMO_OPTS.find((o) => o.band === demoBand)?.label}`;

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

      {/* Demo 控制：浮在手機框外，點開可直接切低/中/高強度 */}
      <div className={`hr-demo ${demoBand != null ? "on" : ""}`}>
        <button
          className="hr-demo-fab"
          onClick={() => setDemoOpen((o) => !o)}
        >
          {demoLabel}
        </button>
        {demoOpen && (
          <div className="hr-demo-menu">
            {/* 只用真實資料：不跑任何模擬，沒收到毫米波心率就顯示等待畫面 */}
            <button
              className={`hr-demo-item real ${realOnly ? "sel" : ""}`}
              onClick={pickRealOnly}
            >
              只用真實資料
            </button>
            <button
              className={`hr-demo-item ${demoBand === -1 ? "sel" : ""}`}
              onClick={() => pickDemo(-1)}
            >
              隨機
            </button>
            {DEMO_OPTS.map((o) => (
              <button
                key={o.band}
                className={`hr-demo-item ${demoBand === o.band ? "sel" : ""}`}
                onClick={() => pickDemo(o.band)}
              >
                {o.label}
              </button>
            ))}
            <button
              className={`hr-demo-item off ${demoBand == null && !realOnly ? "sel" : ""}`}
              onClick={() => {
                setRealOnly(false);
                pickDemo(null);
              }}
            >
              關閉（自動）
            </button>
          </div>
        )}
      </div>

      {!base && <BaselineForm onStart={setBase} />}
      {/* 只用真實資料且尚未收到心率 → 圖表照常顯示，數值以「—」呈現（不跑模擬曲線） */}
      {base && live && (
        <Dashboard
          base={base}
          live={live}
          data={live.real ? data : demoBand != null ? live.tele : data}
        />
      )}

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
