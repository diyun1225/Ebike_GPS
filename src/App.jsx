import { useState } from "react";
import HomeScreen from "./HomeScreen.jsx";
import NavigationMode from "./modes/navigation/NavigationMode.jsx";
import HeartRateMode from "./modes/heartrate/HeartRateMode.jsx";

// 整個 App 的最上層：在主畫面選模式，再切到各模式的程式
export default function App() {
  const [mode, setMode] = useState(null); // null = 主畫面

  const backToHome = () => setMode(null);

  if (mode === "navigation") return <NavigationMode onBack={backToHome} />;
  if (mode === "heartrate") return <HeartRateMode onBack={backToHome} />;
  if (mode === "suspension")
    return <ComingSoon title="智慧避震模式" icon="🔧" onBack={backToHome} />;
  return <HomeScreen onSelect={setMode} />;
}

// 尚未實作的模式：即將推出佔位畫面
function ComingSoon({ title, icon, onBack }) {
  return (
    <div className="dash placeholder">
      <button className="mode-back" onClick={onBack} aria-label="返回主畫面">
        ‹ 主畫面
      </button>
      <div className="placeholder-body">
        <div className="placeholder-icon">{icon}</div>
        <h2>{title}</h2>
        <p>即將推出</p>
      </div>
    </div>
  );
}
