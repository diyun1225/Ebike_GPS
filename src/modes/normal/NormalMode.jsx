import { useState } from "react";
import { useBle } from "../../ble/BleContext.jsx";

// 沒有數值（null / undefined）時統一顯示破折號
const fmt = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);

// 一張數據小卡
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

// 助力段位數值 → 模式名稱（對照韌體 assistModeName）
const ASSIST_NAMES = ["off", "eco", "eco+", "normal", "sport", "sport+"];

// 控制區：變速（升/降檔）＋ 助力段位（0~5），透過 BLE 送指令給板子
function Controls({ commandedAssist, onShiftUp, onShiftDown, onSetAssist }) {
  return (
    <div className="nm-controls">
      <div className="nm-ctl-block">
        <span className="nm-ctl-label">變速</span>
        <div className="nm-shift">
          <button className="nm-shift-btn" onClick={onShiftDown}>
            降檔 ▼
          </button>
          <button className="nm-shift-btn" onClick={onShiftUp}>
            升檔 ▲
          </button>
        </div>
      </div>

      <div className="nm-ctl-block">
        <span className="nm-ctl-label">助力段位</span>
        <div className="nm-assist-btns">
          {ASSIST_NAMES.map((name, lvl) => (
            <button
              key={lvl}
              className={`nm-assist-btn ${commandedAssist === lvl ? "on" : ""}`}
              onClick={() => onSetAssist(lvl)}
            >
              <b>{lvl}</b>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// 助力等級（0~5）階梯段位
function AssistBar({ level }) {
  const total = 5;
  const on = level == null ? 0 : Math.max(0, Math.min(total, level));
  return (
    <div className="nm-assist">
      <div className="nm-assist-head">
        <span>助力等級</span>
        <b>{level == null ? "—" : level}</b>
      </div>
      <div className="nm-assist-bars">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`nm-assist-seg ${i < on ? "on" : ""}`}
            style={{ height: `${45 + i * 13}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function Dashboard({ data }) {
  const d = data || {};
  const soc = d.batterySocPct;
  const socPct = soc == null ? 0 : Math.max(0, Math.min(100, soc));
  const socColor = socPct <= 20 ? "#e0533d" : socPct <= 50 ? "#f5a623" : "#2fa860";

  return (
    <div className="nm-dash">
      {/* 主角：時速 */}
      <div className="nm-hero">
        <b className="nm-hero-num">{fmt(d.speedKph, 1)}</b>
        <span className="nm-hero-unit">km/h</span>
        <span className="nm-hero-sub">目前時速</span>
      </div>

      {/* 電量條 */}
      <div className="nm-battery">
        <div className="nm-battery-head">
          <span>電池電量</span>
          <b style={{ color: socColor }}>{soc == null ? "—" : `${soc}%`}</b>
        </div>
        <div className="nm-battery-track">
          <span
            className="nm-battery-fill"
            style={{ width: `${socPct}%`, background: socColor }}
          />
        </div>
        <div className="nm-battery-sub">
          <span>{fmt(d.batteryVoltageMv != null ? d.batteryVoltageMv / 1000 : null, 1)} V</span>
          <span>{fmt(d.batteryCurrentMa != null ? d.batteryCurrentMa / 1000 : null, 1)} A</span>
        </div>
      </div>

      {/* 助力等級 */}
      <AssistBar level={d.assistLevel} />

      {/* 其餘數據卡 */}
      <div className="nm-grid">
        <StatCard label="踏頻" value={fmt(d.cadenceRpm)} unit="rpm" />
        <StatCard label="踏板扭力" value={fmt(d.torqueNm, 1)} unit="Nm" />
        <StatCard label="馬達轉速" value={fmt(d.motorRpm)} unit="rpm" />
        <StatCard label="馬達溫度" value={fmt(d.motorTempC)} unit="°C" accent="#e0813d" />
        <StatCard
          label="後變速檔位"
          value={d.rearGear ? `${d.rearGear.index}/${d.rearGear.max}` : "—"}
        />
        <StatCard
          label="電池溫度"
          value={
            d.batteryTempsC && d.batteryTempsC.some((t) => t != null)
              ? Math.max(...d.batteryTempsC.filter((t) => t != null))
              : "—"
          }
          unit="°C"
          accent="#e0813d"
        />
      </div>
    </div>
  );
}

export default function NormalMode({ onBack }) {
  const {
    phase,
    data,
    error,
    logLines,
    rawLines,
    clearLog,
    canControl,
    commandedAssist,
    shiftUp,
    shiftDown,
    setAssist,
  } = useBle(); // 共用 App 層那條連線（連線在主畫面做，這裡只讀資料）
  const [confirmExit, setConfirmExit] = useState(false);
  const [showDiag, setShowDiag] = useState(false); // 診斷面板（log + 原始封包）展開
  const connected = phase === "connected";

  return (
    <div className="dash nm">
      <button
        className="mode-back"
        onClick={() => setConfirmExit(true)}
        aria-label="返回主畫面"
      >
        ‹ 主畫面
      </button>

      <h1 className="nm-header">一般模式</h1>

      {error && <div className="nm-error">{error}</div>}

      {connected && canControl && (
        <Controls
          commandedAssist={commandedAssist}
          onShiftUp={shiftUp}
          onShiftDown={shiftDown}
          onSetAssist={setAssist}
        />
      )}

      {connected || data ? (
        <Dashboard data={data} />
      ) : (
        <div className="nm-empty">
          <div className="nm-empty-icon">🚲</div>
          <p>尚未連線。請回主畫面點「連線運算板」與 CCPA-Telemetry 配對，即可即時讀取車況數據。</p>
          <p className="nm-empty-hint">
            需 HTTPS 或 localhost；iPhone 請用 Bluefy 瀏覽器開啟。
          </p>
        </div>
      )}

      {/* 診斷面板：對照 ble_phone.html 的「診斷 Log」＋「原始封包」。
          手機（Bluefy）沒有 console，靠這裡看連線卡在哪步、板子有沒有在送資料。 */}
      {(logLines.length > 0 || rawLines.length > 0) && (
        <div className="nm-diag">
          <button
            className="nm-diag-toggle"
            onClick={() => setShowDiag((v) => !v)}
          >
            <span>診斷資訊（log {logLines.length}・封包 {rawLines.length}）</span>
            <span>{showDiag ? "▲" : "▼"}</span>
          </button>

          {showDiag && (
            <>
              <div className="nm-diag-bar">
                <span>收到 BLE 才會有「⑦」；一直沒⑦＝板子沒送資料</span>
                <button className="nm-diag-clear" onClick={clearLog}>
                  清空
                </button>
              </div>

              <div className="nm-diag-block">
                <div className="nm-diag-title">原始封包（最新在最上面）</div>
                <pre className="nm-diag-pre">
                  {rawLines.length ? rawLines.join("\n") : "（尚未收到封包）"}
                </pre>
              </div>

              <div className="nm-diag-block">
                <div className="nm-diag-title">診斷 Log</div>
                <pre className="nm-diag-pre">
                  {logLines.length ? logLines.join("\n") : "（尚未開始）"}
                </pre>
              </div>
            </>
          )}
        </div>
      )}

      {confirmExit && (
        <div className="hr-modal-backdrop" onClick={() => setConfirmExit(false)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-icon">🚪</div>
            <h3>確定要離開一般模式？</h3>
            <div className="hr-modal-actions">
              <button
                className="hr-modal-cancel"
                onClick={() => setConfirmExit(false)}
              >
                取消
              </button>
              <button
                className="hr-modal-ok"
                onClick={onBack}
              >
                離開
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
