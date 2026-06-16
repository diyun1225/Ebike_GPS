import { useState } from "react";
import { fmtDist } from "../slope.js";
import SegmentList from "./SegmentList.jsx";

export default function Sidebar({
  ready,
  loading,
  status,
  summary,
  segments,
  onPlan,
  onFocusSegment,
  onStartNav,
}) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [rider, setRider] = useState(70);
  const [cargo, setCargo] = useState(0);

  const BIKE_KG = 25; // 車身固定重量

  function submit() {
    const weightKg =
      (parseFloat(rider) || 0) + (parseFloat(cargo) || 0) + BIKE_KG;
    onPlan({
      origin: origin.trim(),
      destination: destination.trim(),
      mode: "BICYCLING", // 固定自行車
      auto: true, // 固定自動依坡度分段
      weightKg,
    });
  }

  return (
    <aside id="sidebar">
      <h1>🚴 路線坡度規劃</h1>

      <div className="field">
        <label>起始地</label>
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="例：台中火車站"
        />
      </div>

      <div className="field">
        <label>目的地</label>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="例：東海大學"
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label>騎士體重 (kg)</label>
          <input
            type="number"
            min="0"
            value={rider}
            onChange={(e) => setRider(e.target.value)}
          />
        </div>
        <div className="field">
          <label>載貨重量 (kg)</label>
          <input
            type="number"
            min="0"
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
          />
        </div>
      </div>

      <button onClick={submit} disabled={!ready || loading}>
        {loading ? "規劃中…" : ready ? "規劃路線" : "地圖載入中…"}
      </button>

      {summary && (
        <>
          <button className="nav-start" onClick={onStartNav}>
            🧭 進入導航模式
          </button>

          <div id="summary">
            <div className="stat"><span>總距離</span><b>{fmtDist(summary.totalDist)}</b></div>
            <div className="stat"><span>預估時間</span><b>{summary.duration}</b></div>
            <div className="stat"><span>總爬升</span><b>{summary.totalGain.toFixed(0)} m</b></div>
            <div className="stat"><span>總下降</span><b>{summary.totalLoss.toFixed(0)} m</b></div>
            <div className="stat"><span>最陡一段</span><b>{summary.maxGrade.toFixed(1)}%</b></div>
          </div>
        </>
      )}

      <div id="status" className={status.error ? "err" : "ok"}>
        {status.msg}
      </div>

      <SegmentList segments={segments} onFocus={onFocusSegment} />
    </aside>
  );
}
