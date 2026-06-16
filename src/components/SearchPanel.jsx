import { useState } from "react";

// 浮在地圖上方的搜尋卡。支援多個目的地（途經點）。
export default function SearchPanel({ ready, loading, status, summary, onPlan }) {
  const [stops, setStops] = useState(["", ""]); // 至少 起點 + 終點
  const [rider, setRider] = useState(70);
  const [cargo, setCargo] = useState(0);
  const [editing, setEditing] = useState(false);

  const BIKE_KG = 25;
  const collapsed = summary && !editing;

  function setStop(i, v) {
    setStops((prev) => prev.map((s, idx) => (idx === i ? v : s)));
  }
  function addStop() {
    setStops((prev) => [...prev, ""]);
  }
  function removeStop(i) {
    setStops((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    const weightKg =
      (parseFloat(rider) || 0) + (parseFloat(cargo) || 0) + BIKE_KG;
    onPlan({
      stops: stops.map((s) => s.trim()).filter(Boolean),
      mode: "BICYCLING",
      auto: true,
      weightKg,
    });
    setEditing(false);
  }

  if (collapsed) {
    const list = stops.filter(Boolean);
    const first = list[0] || "起點";
    const last = list[list.length - 1] || "終點";
    const midCount = Math.max(0, list.length - 2);
    return (
      <div className="search collapsed" onClick={() => setEditing(true)}>
        <span className="oneline">
          <b>📍 {first}</b>
          {midCount > 0 && <span className="mid"> · 經 {midCount} 點</span>}
          <span className="arrow">→</span>
          <b>🏁 {last}</b>
        </span>
        <span className="edit">✎</span>
      </div>
    );
  }

  return (
    <div className="search">
      {stops.map((s, i) => {
        const isFirst = i === 0;
        const isLast = i === stops.length - 1;
        return (
          <div className="stop-row" key={i}>
            <span className="stop-dot">
              {isFirst ? "📍" : isLast ? "🏁" : "⚪"}
            </span>
            <input
              value={s}
              onChange={(e) => setStop(i, e.target.value)}
              placeholder={isFirst ? "起點" : isLast ? "目的地" : "途經點"}
            />
            {stops.length > 2 && (
              <button
                className="stop-del"
                onClick={() => removeStop(i)}
                aria-label="移除"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      <button className="add-stop" onClick={addStop}>
        ＋ 新增目的地
      </button>

      <div className="wrow">
        <input
          type="number"
          min="0"
          value={rider}
          onChange={(e) => setRider(e.target.value)}
          placeholder="騎士kg"
        />
        <input
          type="number"
          min="0"
          value={cargo}
          onChange={(e) => setCargo(e.target.value)}
          placeholder="載貨kg"
        />
      </div>

      <button className="plan-btn" onClick={submit} disabled={!ready || loading}>
        {loading ? "規劃中…" : ready ? "規劃路線" : "地圖載入中…"}
      </button>
      {status.msg && (
        <div className={`s-status ${status.error ? "err" : "ok"}`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
