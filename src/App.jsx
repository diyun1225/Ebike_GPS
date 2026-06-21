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
  return <HomeScreen onSelect={setMode} />;
}
