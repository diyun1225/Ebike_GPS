import { fmtDist, gradeColor } from "../slope.js";
import Speedometer from "./Speedometer.jsx";
import batteryIcon from "../../../assets/icon-battery.png";

const ASSIST = ["關閉", "ECO", "Tour", "Sport", "Turbo", "Boost"];

// 轉彎動作 → 箭頭
const ARROW = {
  "turn-right": "↱",
  "turn-left": "↰",
  "turn-slight-right": "↗",
  "turn-slight-left": "↖",
  "turn-sharp-right": "↱",
  "turn-sharp-left": "↰",
  "uturn-right": "⮌",
  "uturn-left": "⮌",
  straight: "↑",
  "ramp-right": "↗",
  "ramp-left": "↖",
  merge: "↑",
  "fork-right": "↗",
  "fork-left": "↖",
  "roundabout-right": "↻",
  "roundabout-left": "↺",
  arrive: "🏁",
  depart: "↑",
};

function fmtTurn(m) {
  if (!m) return "";
  return m >= 1000
    ? (m / 1000).toFixed(1) + " 公里"
    : Math.round(m / 10) * 10 + " 公尺";
}

export default function NavOverlay({
  live,
  summary,
  riding,
  gps,
  remainM,
  finished,
  speedMult,
  onCycleSpeed,
  onToggleRide,
  onToggleGps,
  onExit,
}) {
  const battColor =
    live.battery > 40 ? "#1db954" : live.battery > 15 ? "#f5a623" : "#e53935";

  const arrow = finished ? "🏁" : ARROW[live.maneuver] || "↑";
  const road = finished
    ? "已抵達目的地"
    : live.instruction || (riding ? "前方道路" : "準備出發");
  const turnText = !finished && live.turnM ? fmtTurn(live.turnM) : "";

  // 剩餘時間（依剩餘距離比例推估）
  const showRiding = riding && remainM != null;
  const frac =
    summary && remainM != null
      ? Math.max(0, Math.min(1, remainM / summary.totalDist))
      : 1;
  const remainMin = summary ? Math.max(1, Math.round((summary.durationSec * frac) / 60)) : 0;

  return (
    <div className="nav-overlay">
      {/* 頂部轉彎指示 */}
      <div className="nav-instruction">
        <div className="nav-maneuver">{arrow}</div>
        <div className="nav-instr-text">
          {turnText && <div className="nav-turn-dist">{turnText}</div>}
          <div className="nav-turn-road">{road}</div>
        </div>
      </div>

      {/* GPS 真實導航切換（右上） */}
      <button
        className={`nav-gps ${gps ? "on" : ""}`}
        onClick={onToggleGps}
        aria-label="GPS 導航"
      >
        📍
      </button>

      {/* Demo 控制（陽春樣式）：在綠色路線指引塊下方。模擬騎乘播放 + 倍速 */}
      <div className="nav-demo">
        <span className="nav-demo-tag">DEMO</span>
        <button className="nav-demo-btn" onClick={onToggleRide}>
          {finished ? "↺ 重新" : riding ? "⏸ 暫停" : "▶ 開始"}
        </button>
        <button className="nav-demo-btn" onClick={onCycleSpeed}>
          ×{speedMult} 倍速
        </button>
      </div>

      {/* 底部儀表板：時速表 + 電量 + 輔助段位 */}
      <div className="nav-dash">
        <div className="dash-cluster">
          <div className="dash-side">
            <div className="dash-icon">
              <img className="dash-icon-img" src={batteryIcon} alt="電量" />
            </div>
            <div className="dash-val" style={{ color: battColor }}>
              {live.battery.toFixed(0)}%
            </div>
            <div className="dash-lbl">電量</div>
          </div>

          <div className="dash-center">
            <Speedometer speed={live.speed} max={25} />
            <div className="dash-extra">
              <span>踏頻 {live.cadence} rpm</span>
              <span style={{ color: gradeColor(live.grade ?? 0) }}>
                坡度 {(live.grade ?? 0) >= 0 ? "+" : ""}
                {(live.grade ?? 0).toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="dash-side">
            {/* 換 icon：把這個 emoji 換成 <img className="dash-icon-img" src={assistIcon} alt="" /> */}
            <div className="dash-icon">⚡</div>
            <div className="dash-val">{ASSIST[live.assist]}</div>
            <div className="dash-lbl">輔助段位</div>
          </div>
        </div>

        <div className="dash-info">
          <div className="nav-bottom-main">
            <div className="nav-big">
              {showRiding ? `${remainMin} 分鐘` : summary?.duration}
            </div>
            <div className="nav-sub">
              {showRiding ? fmtDist(remainM) : fmtDist(summary?.totalDist || 0)} ·{" "}
              {summary?.eta} 抵達
            </div>
          </div>

          <button className="nav-end" onClick={onExit}>
            結束
          </button>
        </div>
      </div>
    </div>
  );
}
