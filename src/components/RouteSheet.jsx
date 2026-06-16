import { fmtDist } from "../slope.js";
import SegmentList from "./SegmentList.jsx";

// 浮在地圖底部的路線資訊卡（可上下捲動看分段）
export default function RouteSheet({
  summary,
  segments,
  live,
  onFocusSegment,
  onStartNav,
}) {
  const remain = Math.max(0, live.battery - summary.estUsedPct);

  return (
    <div className="sheet">
      <div className="sheet-handle" />

      <div className="sheet-stats">
        <div><b>{fmtDist(summary.totalDist)}</b><span>距離</span></div>
        <div><b>{summary.duration}</b><span>時間</span></div>
        <div><b>{summary.eta}</b><span>預估抵達</span></div>
        <div><b>↑{summary.totalGain.toFixed(0)}m</b><span>爬升</span></div>
        <div><b>{remain.toFixed(0)}%</b><span>剩餘電量</span></div>
      </div>

      <button className="nav-start" onClick={onStartNav}>
        🧭 開始導航
      </button>

      <SegmentList segments={segments} onFocus={onFocusSegment} />
    </div>
  );
}
