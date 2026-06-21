const ASSIST = ["關閉", "ECO", "Tour", "Sport", "Turbo", "Boost"];

// 浮在地圖頂端的細長即時數據條
export default function Telemetry({ live }) {
  const battColor =
    live.battery > 40 ? "#1db954" : live.battery > 15 ? "#f5a623" : "#ff5a5a";

  return (
    <div className="tbar">
      <div className="pill">
        <span className="pi">🔋</span>
        <b style={{ color: battColor }}>{live.battery.toFixed(0)}%</b>
      </div>
      <div className="pill">
        <span className="pi">🚴</span>
        <b>{live.speed}<small>km/h</small></b>
      </div>
      <div className="pill">
        <span className="pi">🌀</span>
        <b>{live.cadence}<small>rpm</small></b>
      </div>
      <div className="pill">
        <span className="pi">⚡</span>
        <b>{ASSIST[live.assist]}</b>
      </div>
    </div>
  );
}
