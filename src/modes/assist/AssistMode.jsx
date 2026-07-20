import { useState } from "react";
import { useBle } from "../../ble/BleContext.jsx";
import BleConnectPanel from "../../ble/BleConnectPanel.jsx";

// 沒有數值時統一顯示破折號
const fmt = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);
const has = (v) => v != null && !Number.isNaN(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 輔助力段位數值 → 顯示單詞（對照韌體 assistModeName）
const ASSIST_WORDS = ["Off", "Eco", "Eco+", "Normal", "Sport", "Sport+"];
const ASSIST_TOTAL = 5; // 段數條格數（0=Off 不亮格，1~5 對應亮 1~5 格）

// ── 主角：模型推論的輔助力檔位（智慧輔助模式運算板自動控制，讀車子回報的當下檔位）──
function AssistHero({ level }) {
  const on = has(level);
  const lv = on ? clamp(level, 0, ASSIST_TOTAL) : 0;
  const word = on ? ASSIST_WORDS[lv] : "—";
  // 段位越高色調越暖：Off/Eco 綠 → Normal 靛 → Sport 橘
  const color = !on ? "#9aa7a0" : lv >= 4 ? "#f5a623" : lv >= 3 ? "#5b6ee0" : "#2fa860";
  return (
    <div className="am-hero" style={{ "--ac": color }}>
      <span className="am-hero-cap">模型推論・建議輔助力檔位</span>
      <b className="am-hero-word">{word}</b>
      <span className="am-hero-level">
        {on ? (lv === 0 ? "無輔助" : `第 ${lv} 段 / ${ASSIST_TOTAL}`) : "尚無資料"}
      </span>
      <div className="am-hero-bars">
        {Array.from({ length: ASSIST_TOTAL }).map((_, i) => (
          <span
            key={i}
            className={`am-hero-seg ${i < lv ? "on" : ""}`}
            style={{
              height: `${44 + i * 14}%`,
              ...(i < lv ? { background: color } : null),
            }}
          />
        ))}
      </div>
      <span className="am-hero-sub">智慧輔助模式・運算板依即時車況自動調整</span>
    </div>
  );
}

// 主時速圓弧儀表（270° 掃角，缺口朝下；沿用一般模式的視覺）
function SpeedGauge({ value, max = 40 }) {
  const on = has(value);
  const v = on ? clamp(value, 0, max) : 0;
  const frac = v / max;
  const size = 208, stroke = 18;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const CIRC = 2 * Math.PI * r;
  const dash = CIRC * 0.75; // 270°
  const color = on && value >= 25 ? "#f5a623" : "#2fa860";
  return (
    <div className="nm-gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="nm-gauge-svg" aria-hidden="true">
        <circle
          className="nm-gauge-track"
          cx={c} cy={c} r={r} fill="none"
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRC}`}
          transform={`rotate(135 ${c} ${c})`}
        />
        <circle
          className="nm-gauge-fill"
          cx={c} cy={c} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash * frac} ${CIRC}`}
          transform={`rotate(135 ${c} ${c})`}
        />
      </svg>
      <div className="nm-gauge-center">
        <b className="nm-gauge-num">{on ? fmt(value, 1) : "—"}</b>
        <span className="nm-gauge-unit">km/h</span>
        <span className="nm-gauge-cap">目前時速</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit, accent }) {
  return (
    <div className="nm-card">
      <span className="nm-card-label">{label}</span>
      <b className="nm-card-value" style={accent ? { color: accent } : null}>
        {value}
        {unit && <small className="nm-card-unit">{unit}</small>}
      </b>
    </div>
  );
}

function AssistDashboard({ data }) {
  const d = data || {};
  const battTemp =
    d.batteryTempsC && d.batteryTempsC.some((t) => t != null)
      ? Math.max(...d.batteryTempsC.filter((t) => t != null))
      : null;
  const gear = d.rearGear; // { index, max }

  return (
    <div className="nm-dash am-dash">
      {/* 主角：模型推論的建議輔助力檔位 */}
      <AssistHero level={d.assistLevel} />

      {/* 目前車況：時速置中 */}
      <div className="am-speedwrap">
        <SpeedGauge value={has(d.speedKph) ? d.speedKph : null} />
      </div>

      {/* 車況數據卡：踏頻 / 踏板扭力 / 馬達轉速 / 馬達溫度 */}
      <div className="nm-grid">
        <StatCard label="踏頻" value={fmt(d.cadenceRpm)} unit="rpm" />
        <StatCard label="踏板扭力" value={fmt(d.torqueNm, 1)} unit="Nm" />
        <StatCard label="馬達轉速" value={fmt(d.motorRpm)} unit="rpm" />
        <StatCard label="馬達溫度" value={fmt(d.motorTempC)} unit="°C" accent="#e0813d" />
      </div>

      {/* 變速檔位 / 電量 */}
      <div className="nm-grid">
        <StatCard
          label="變速檔位"
          value={gear ? (gear.max ? `${gear.index} / ${gear.max}` : `${gear.index}`) : "—"}
        />
        <StatCard
          label="電池電量"
          value={d.batterySocPct == null ? "—" : `${d.batterySocPct}`}
          unit={d.batterySocPct == null ? "" : "%"}
          accent="#2fa860"
        />
      </div>

      {/* 電池明細：電壓 / 電流 / 電池溫度 */}
      <div className="nm-detail">
        <span>
          <i>電壓</i>
          <b>{fmt(d.batteryVoltageMv != null ? d.batteryVoltageMv / 1000 : null, 1)} V</b>
        </span>
        <span>
          <i>電流</i>
          <b>{fmt(d.batteryCurrentMa != null ? d.batteryCurrentMa / 1000 : null, 1)} A</b>
        </span>
        <span>
          <i>電池溫度</i>
          <b>{has(battTemp) ? `${battTemp} °C` : "—"}</b>
        </span>
      </div>
    </div>
  );
}

export default function AssistMode({ onBack }) {
  const { phase, data, error, isDemo } = useBle();
  const [confirmExit, setConfirmExit] = useState(false);
  const connected = phase === "connected";

  return (
    <div className="dash nm am">
      <button
        className="mode-back"
        onClick={() => setConfirmExit(true)}
        aria-label="返回主畫面"
      >
        ‹ 主畫面
      </button>

      <div className="nm-topbar">
        <h1 className="nm-header">智慧輔助模式</h1>
      </div>

      {/* 自行車連線控制（不用回主畫面即可連線） */}
      <BleConnectPanel className="nm-ble-stack" />

      {error && <div className="nm-error">{error}</div>}

      {connected || data || isDemo ? (
        <AssistDashboard data={data} />
      ) : (
        <div className="nm-empty">
          <div className="nm-empty-icon">💪</div>
          <p>
            尚未連線。點上方「連線自行車」與 CCPA-Telemetry 配對，即可即時讀取運算板
            推論的建議輔助力檔位與車況數據。
          </p>
          <p className="nm-empty-hint">需 HTTPS 或 localhost；iPhone 請用 Bluefy 瀏覽器開啟。</p>
        </div>
      )}

      {confirmExit && (
        <div className="hr-modal-backdrop" onClick={() => setConfirmExit(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-icon">🚪</div>
            <h3>確定要離開智慧輔助模式？</h3>
            <div className="hr-modal-actions">
              <button className="hr-modal-cancel" onClick={() => setConfirmExit(false)}>
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
