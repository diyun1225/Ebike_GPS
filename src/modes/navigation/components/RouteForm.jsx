// 進入電量管理模式的第一步：先填路線與重量（此時不顯示地圖），
// 風格對齊心肺模式的設定表單。按「規劃路線」後才會跑出地圖。
export default function RouteForm({
  stops,
  setStops,
  ready,
  loading,
  locating,
  onUseCurrentLocation,
  status,
  onPlan,
}) {
  function setStop(i, v) {
    setStops((prev) => prev.map((s, idx) => (idx === i ? v : s)));
  }
  function addStop() {
    setStops((prev) => [...prev, ""]);
  }
  function removeStop(i) {
    setStops((prev) => prev.filter((_, idx) => idx !== i));
  }

  const enoughStops = stops.filter((s) => s.trim()).length >= 2;
  const canPlan = ready && !loading && enoughStops;

  return (
    <div className="rs-setup">
      <h2>規劃騎乘路線</h2>

      <div className="rs-stops">
        {stops.map((s, i) => {
          const isFirst = i === 0;
          const isLast = i === stops.length - 1;
          return (
            <div className="rs-stop-row" key={i}>
              <span className="rs-dot">
                {isFirst ? "📍" : isLast ? "🏁" : "⚪"}
              </span>
              <input
                value={s}
                onChange={(e) => setStop(i, e.target.value)}
                placeholder={isFirst ? "起點" : isLast ? "目的地" : "途經點"}
              />
              {isFirst && (
                <button
                  type="button"
                  className="rs-here"
                  onClick={onUseCurrentLocation}
                  disabled={locating}
                  aria-label="使用目前位置"
                >
                  {locating ? "定位中…" : "📍目前位置"}
                </button>
              )}
              {stops.length > 2 && (
                <button
                  className="rs-del"
                  onClick={() => removeStop(i)}
                  aria-label="移除"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button className="rs-add" onClick={addStop}>
        ＋ 新增目的地
      </button>

      <button className="rs-start" onClick={onPlan} disabled={!canPlan}>
        {loading ? "規劃中…" : ready ? "規劃路線" : "地圖載入中…"}
      </button>

      {status?.msg && (
        <div className={`s-status ${status.error ? "err" : "ok"}`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
