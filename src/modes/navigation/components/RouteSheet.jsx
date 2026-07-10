import { useRef, useState } from "react";
import { fmtDist } from "../slope.js";

// 浮在地圖底部的路線資訊卡：抓住上方握把可上下拖曳改變高度，內容也可捲動
// 註：坡度路段清單已移出畫面（後台仍計算 segments，供 CAN 上傳／地圖同步用）
export default function RouteSheet({ summary, live, onStartNav }) {
  // 未連車（live.battery == null）時無法得知目前電量 → 剩餘電量顯示 —
  const remain =
    live.battery == null ? null : Math.max(0, live.battery - summary.estUsedPct);
  const sheetRef = useRef(null);
  const [height, setHeight] = useState(null); // null = 用 CSS 預設高度

  // 拖曳握把調整卡片高度（往上拖變高、往下拖變矮）
  function startDrag(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = sheetRef.current.offsetHeight;
    const min = 240; // 至少看得到數據 + 開始導航鈕
    const max = window.innerHeight * 0.9;
    const move = (ev) => {
      const dy = startY - ev.clientY;
      setHeight(Math.max(min, Math.min(max, startH + dy)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className="sheet"
      ref={sheetRef}
      style={height ? { height: `${height}px`, maxHeight: "none" } : undefined}
    >
      <div className="sheet-grab" onPointerDown={startDrag}>
        <div className="sheet-handle" />
      </div>

      <div className="sheet-stats">
        <div><b>{fmtDist(summary.totalDist)}</b><span>距離</span></div>
        <div><b>{summary.duration}</b><span>時間</span></div>
        <div><b>{summary.eta}</b><span>預估抵達</span></div>
        <div><b>{remain == null ? "—" : `${remain.toFixed(0)}%`}</b><span>預估剩餘電量</span></div>
      </div>

      <button className="nav-start" onClick={onStartNav}>
        開始導航
      </button>
    </div>
  );
}
