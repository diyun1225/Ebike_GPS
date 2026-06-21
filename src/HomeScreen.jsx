// 主畫面：選擇要進入哪個模式
// 之後要新增模式，只要在這個陣列加一筆、再到 App.jsx 接上對應元件即可
const MODES = [
  {
    id: "navigation",
    icon: "🧭",
    title: "導航模式",
    desc: "規劃路線、坡度分析與即時導航",
    enabled: true,
  },
  {
    id: "heartrate",
    icon: "❤️",
    title: "心率模式",
    desc: "即時心率與運動數據",
    enabled: true,
  },
];

export default function HomeScreen({ onSelect }) {
  return (
    <div className="dash home">
      <div className="home-head">
        <div className="home-logo">🚴</div>
        <h1 className="home-title">E-Bike 儀表板</h1>
        <p className="home-sub">選擇模式</p>
      </div>

      <div className="home-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className="mode-card"
            disabled={!m.enabled}
            onClick={() => m.enabled && onSelect(m.id)}
          >
            <span className="mode-card-icon">{m.icon}</span>
            <span className="mode-card-text">
              <span className="mode-card-title">{m.title}</span>
              <span className="mode-card-desc">{m.desc}</span>
            </span>
            <span className="mode-card-arrow">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
