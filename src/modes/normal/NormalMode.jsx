import { useEffect, useRef, useState } from "react";
import { useBle } from "../../ble/BleContext.jsx";
import BleConnectPanel from "../../ble/BleConnectPanel.jsx";
import { fiToPct } from "../../ble/vitalsBle.js";
import useImuMqtt from "./useImuMqtt.js";
import padlockIcon from "../../assets/padlock.png";

// 沒有數值（null / undefined）時統一顯示破折號
const fmt = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);

const has = (v) => v != null && !Number.isNaN(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 輔助力段位數值 → 顯示單詞（對照韌體 assistModeName）
const ASSIST_WORDS = ["Off", "Eco", "Eco+", "Normal", "Sport", "Sport+"];

// ── 主時速圓弧儀表（270° 掃角，缺口朝下）──
function SpeedGauge({ value, max = 40 }) {
  const on = has(value);
  const v = on ? clamp(value, 0, max) : 0;
  const frac = v / max;
  const size = 244, stroke = 20;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const CIRC = 2 * Math.PI * r;
  const SWEEP = 0.75; // 270°
  const dash = CIRC * SWEEP;
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

// 電池電量：直立電池外型 + 五格（每格 20%，由下往上填）
function BatteryVert({ soc }) {
  const pct = has(soc) ? clamp(soc, 0, 100) : 0;
  const filled = pct > 0 ? Math.max(1, Math.round(pct / 20)) : 0;
  const color = pct <= 20 ? "#e0533d" : pct <= 50 ? "#f5a623" : "#2fa860";
  return (
    <div className="nm-battv">
      <span className="nm-battv-cap" />
      <div className="nm-battv-shell">
        {Array.from({ length: 5 }).map((_, i) => {
          const on = i >= 5 - filled; // 由下往上亮
          return (
            <span
              key={i}
              className={`nm-battv-cell ${on ? "on" : ""}`}
              style={on ? { background: color } : null}
            />
          );
        })}
      </div>
    </div>
  );
}

// 輔助力：只顯示單詞（Off / Eco / Eco+ / Normal / Sport / Sport+）
function AssistLevel({ level }) {
  const word = level == null ? "—" : ASSIST_WORDS[clamp(level, 0, 5)];
  return (
    <div className="nm-corner-assist">
      <span className="nm-corner-label">輔助力</span>
      <b className="nm-corner-word">{word}</b>
    </div>
  );
}

// 電子坐墊：預設鎖定，長按鎖頭才解鎖，避免騎乘中誤觸。
// 解鎖後只要按住鎖頭就維持解鎖；一放開就立刻重新上鎖。
// CAN：長按解鎖完成 → 送 DROPPER,UNLOCK；放開重新上鎖 → 送 DROPPER,LOCK（0x2940035）。
const SEAT_UNLOCK_MS = 700; // 長按這麼久才解鎖

function SeatControl() {
  const { unlockSeat, lockSeat, canControl } = useBle();
  const [locked, setLocked] = useState(true);
  const [holding, setHolding] = useState(false); // 解鎖長按進行中
  const unlockTimer = useRef(null);
  const unlockedRef = useRef(false); // 是否真的解鎖過（避免短按也送 LOCK）

  // 鎖頭：長按解鎖；放開就重新上鎖
  const onLockDown = (e) => {
    // 觸控時鎖定 pointer 到本按鈕，避免微小位移被判成手勢而中斷長按
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!canControl) return; // 沒有可送控制指令的連線：不假裝解鎖，改在下方顯示提示
    if (!locked) return; // 已解鎖：維持解鎖，放開時才上鎖
    setHolding(true);
    unlockTimer.current = setTimeout(() => {
      setHolding(false);
      setLocked(false);
      unlockedRef.current = true;
      unlockSeat(); // 送 DROPPER,UNLOCK
    }, SEAT_UNLOCK_MS);
  };
  const onLockUp = () => {
    setHolding(false);
    clearTimeout(unlockTimer.current);
    setLocked(true); // 放開就上鎖
    if (unlockedRef.current) {
      unlockedRef.current = false;
      lockSeat(); // 只有真的解鎖過才送 DROPPER,LOCK，短按不送
    }
  };

  useEffect(() => () => {
    // 卸載時清掉計時器
    clearTimeout(unlockTimer.current);
  }, []);

  return (
    <div className={`nm-panel nm-seat ${locked ? "locked" : ""}`}>
      <div className="nm-panel-head">
        <span>電子坐墊</span>
        <div className="nm-seat-head-right">
          <button
            className={`nm-seat-lock ${holding ? "holding" : ""}`}
            onPointerDown={onLockDown}
            onPointerUp={onLockUp}
            onPointerCancel={onLockUp}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={locked ? "長按解鎖" : "已解鎖，放開上鎖"}
          >
            <img
              className="nm-seat-lock-img"
              src={padlockIcon}
              alt=""
              style={{ opacity: locked ? 1 : 0.35 }}
            />
          </button>
        </div>
      </div>
      <div className="nm-seat-hint">
        {!canControl
          ? "⚠ 尚未連線可控制的車，指令不會送出"
          : locked
          ? holding
            ? "按住解鎖中…"
            : "已鎖定 · 長按鎖頭解鎖"
          : "已解鎖 · 放開即重新上鎖"}
      </div>
    </div>
  );
}

// 目前疲勞度：0~100 進度條，依高低換色與文字。
function FatigueBar({ value, tip }) {
  const ok = has(value);
  const pct = ok ? clamp(Math.round(value), 0, 100) : 0;
  const color = pct < 40 ? "#2fa860" : pct < 70 ? "#f5a623" : "#e0533d";
  const msg = tip?.trim();
  return (
    <div className="nm-panel nm-fatigue">
      <div className="nm-panel-head">
        <span>目前疲勞度</span>
        <b style={ok ? { color } : null}>{ok ? `${pct}%` : "—"}</b>
      </div>
      <div className="nm-track">
        <span className="nm-track-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      {/* 一句話提醒：內容由組員輸出填入 data.fatigueAdvice；沒有時保留空間 */}
      {/* <div className={`nm-fatigue-tip ${msg ? "" : "empty"}`} style={msg ? { color } : null}>
        {msg || "—"}
      </div> */}
    </div>
  );
}

// IMU 即時數據（MQTT ouo/v1/vehicle/state）：擺在頁面最底下，
// 給「模型輸入 IMU → 輸出檔位」的對照用，平常不用看、要看再滑下來。
const IMU_STATUS_TEXT = {
  connecting: "連線中…",
  connected: "已連線",
  closed: "已斷線",
};

function ImuPanel({ status, imu, lastAt, assistLevel }) {
  const gearWord = assistLevel == null ? "—" : ASSIST_WORDS[clamp(assistLevel, 0, 5)];
  const cells = [
    { label: "ax", value: fmt(imu?.ax_g, 3), unit: "g" },
    { label: "ay", value: fmt(imu?.ay_g, 3), unit: "g" },
    { label: "az", value: fmt(imu?.az_g, 3), unit: "g" },
    { label: "gx", value: fmt(imu?.gx_dps, 3), unit: "dps" },
    { label: "gy", value: fmt(imu?.gy_dps, 3), unit: "dps" },
    { label: "gz", value: fmt(imu?.gz_dps, 3), unit: "dps" },
    { label: "合加速度", value: fmt(imu?.accel_norm_g, 3), unit: "g" },
    { label: "Roll", value: fmt(imu?.roll_deg, 2), unit: "°" },
    ];
  return (
    <div className="nm-panel nm-imu">
      <div className="nm-panel-head">
        <span>
          IMU 即時數據
          <em className={`nm-imu-status ${status}`}>
            MQTT {IMU_STATUS_TEXT[status] || status}
          </em>
        </span>
        {/* 目前檔位：對照模型吃了下面這些輸入後輸出的檔位 */}
        <b>檔位 {gearWord}</b>
      </div>
      <div className="nm-imu-grid">
        {cells.map((c) => (
          <div className="nm-imu-cell" key={c.label}>
            <i>{c.label}</i>
            <b>
              {c.value}
              <small>{c.unit}</small>
            </b>
          </div>
        ))}
      </div>
      <div className="nm-imu-foot">
        {imu
          ? `timestamp_ms ${imu.timestamp_ms ?? "—"} · 最後收到 ${
              lastAt ? new Date(lastAt).toLocaleTimeString() : "—"
            }`
          : "尚未收到資料（topic: ouo/v1/vehicle/state）"}
      </div>
    </div>
  );
}

function Dashboard({ data }) {
  const d = data || {};
  const battTemp =
    d.batteryTempsC && d.batteryTempsC.some((t) => t != null)
      ? Math.max(...d.batteryTempsC.filter((t) => t != null))
      : null;

  return (
    <div className="nm-dash">
      {/* 主儀表座：時速置中，左下電量、右下輔助力 */}
      <div className="nm-cluster">
        <SpeedGauge value={has(d.speedKph) ? d.speedKph : null} />
        <div className="nm-cluster-bl">
          <BatteryVert soc={d.batterySocPct} />
        </div>
        <div className="nm-cluster-br">
          <AssistLevel level={d.assistLevel} />
        </div>
      </div>

      {/* 目前疲勞度（組員藍牙傳來的 data.fatigue） */}
      <FatigueBar value={d.fatigue} tip={d.fatigueAdvice} />

      {/* 心率 / 呼吸率（藍牙傳來的 data.hr、data.rr） */}
      <div className="nm-grid">
        <StatCard label="心率" value={fmt(d.hr)} unit="bpm" accent="#e0533d" />
        <StatCard label="呼吸率" value={fmt(d.rr)} unit="次/分" accent="#2f93b5" />
      </div>

      {/* 其餘數據卡：踏頻 / 扭力 / 馬達轉速 / 馬達溫度 */}
      <div className="nm-grid">
        <StatCard label="踏頻" value={fmt(d.cadenceRpm)} unit="rpm" />
        <StatCard label="踏板扭力" value={fmt(d.torqueNm, 1)} unit="Nm" />
        <StatCard label="馬達轉速" value={fmt(d.motorRpm)} unit="rpm" />
        <StatCard label="馬達溫度" value={fmt(d.motorTempC)} unit="°C" accent="#e0813d" />
      </div>

      {/* 電池明細擺最下面：電壓 / 電流 / 電池溫度 */}
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

      {/* 電子坐墊（最底下）：長按解鎖、放開上鎖 */}
      <SeatControl />
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
    pi, // 樹莓派連線（狀態顯示 / 連線按鈕用）
    vitals, // 統一生理量測（毫米波 hr/rr/fi，不管走樹莓派專線或單車 TX）
  } = useBle(); // 共用 App 層那條連線（連線在主畫面做，這裡只讀資料）
  const imuMq = useImuMqtt(); // 進入一般模式就連 MQTT 讀 IMU，離開自動斷線
  const [confirmExit, setConfirmExit] = useState(false);
  const [showDiag, setShowDiag] = useState(false); // 診斷面板（log + 原始封包）展開
  const connected = phase === "connected";
  const piConnected = pi?.phase === "connected";

  // 把生理量測併進車況資料：hr/rr/疲勞度（fi）。沒帶到就保留車況原值。
  const v = vitals;
  const view = {
    ...data,
    hr: v?.hr ?? data?.hr,
    rr: v?.rr ?? data?.rr,
    fatigue: fiToPct(v?.fi) ?? data?.fatigue,
  };

  return (
    <div className="dash nm">
      <button
        className="mode-back"
        onClick={() => setConfirmExit(true)}
        aria-label="返回主畫面"
      >
        ‹ 主畫面
      </button>

      <div className="nm-topbar">
        <h1 className="nm-header">一般模式</h1>
        {/* 自行車連線狀態不在這裡重複顯示，統一由下方 BleConnectPanel 呈現（含連線/模擬按鈕） */}
      </div>

      {/* 自行車 + 樹莓派連線控制（不用回主畫面即可連線） */}
      <BleConnectPanel className="nm-ble-stack" />

      {error && <div className="nm-error">{error}</div>}

      {connected || data || piConnected ? (
        <Dashboard data={view} />
      ) : (
        <div className="nm-empty">
          <div className="nm-empty-icon">🚲</div>
          <p>尚未連線。點上方「連線自行車」與 CCPA-Telemetry 配對，即可即時讀取車況數據；「連線樹莓派」可讀心率／呼吸率／疲勞度。</p>
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

      {/* IMU 即時數據（MQTT）：獨立於藍牙連線，放在頁面最底下 */}
      <ImuPanel
        status={imuMq.status}
        imu={imuMq.imu}
        lastAt={imuMq.lastAt}
        assistLevel={view.assistLevel}
      />

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
