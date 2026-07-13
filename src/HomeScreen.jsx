// 主畫面：選擇要進入哪個模式
// 新增模式時，在這個陣列加一筆、再到 App.jsx 接上對應元件即可。
// id 是「路由用」的代號（不要亂改，App.jsx 靠它切換）；圖是 Canva 做好的按鈕（圓圈+icon+文字都在裡面）。
import { useEffect, useState } from "react";
import BleConnectPanel from "./ble/BleConnectPanel.jsx";
import normalImg from "./assets/mode-normal.png";
import batteryImg from "./assets/mode-battery.png";
import heartImg from "./assets/mode-heart.png";
// import suspensionImg from "./assets/mode-suspension.png"; // 避震改常開，首頁選項已註解
import assistImg from "./assets/mode-assist.png";
// import shiftImg from "./assets/mode-shift.png"; // 變速改常開，首頁選項已註解
import bgImg from "./assets/bg-home.png";

// labelBelow: 圖片本身沒有烤文字，需由程式在圖下方補上 label
const MODES = [
  {
    id: "normal",
    label: "一般模式",
    img: normalImg,
    accent: "#3a7d55", // 車圖的深綠
    flood: "#eef6f1",
    labelBelow: true,
    enabled: true,
  },
  {
    id: "navigation",
    label: "電量管理模式",
    img: batteryImg,
    accent: "#0e9f4f", // 選定發光用（飽和色）
    flood: "#eef7f0", // 擴散用：跟 icon 圓底同色，轉場才無縫
    labelBelow: true,
    enabled: true,
  },
  {
    id: "heartrate",
    label: "心肺模式",
    img: heartImg,
    accent: "#ff3b5c",
    flood: "#fdeef0",
    labelBelow: true,
    enabled: true,
  },
  // 智慧避震：改成「常開」狀態，不再是可切換模式（暫時註解，保留以便日後恢復）
  // {
  //   id: "suspension",
  //   label: "智慧避震模式",
  //   img: suspensionImg,
  //   accent: "#2f8fd0",
  //   flood: "#eef9fb",
  //   labelBelow: true,
  //   enabled: true,
  // },
  {
    id: "assist",
    label: "智慧輔助模式",
    img: assistImg,
    accent: "#f5a623", // 馬達上的閃電色
    flood: "#fbf7ea", // 跟 icon 圓底的米色一致
    labelBelow: true,
    enabled: true,
  },
  // 智慧變速：改成「常開」狀態，不再是可切換模式（暫時註解，保留以便日後恢復）
  // {
  //   id: "shift",
  //   label: "智慧變速模式",
  //   img: shiftImg,
  //   accent: "#5ab172", // 上下箭頭的綠
  //   flood: "#eef7f0",
  //   labelBelow: true,
  //   enabled: true,
  // },
];

export default function HomeScreen({ onSelect, pending }) {
  const [picked, setPicked] = useState(null); // 已選的模式 id（播放動畫用）
  // 擴散轉場：從被點的按鈕中心，用該模式的顏色鋪滿整個畫面
  const [flood, setFlood] = useState(null); // { color, x, y }

  // 確認視窗被取消（pending 清空但沒真的進入）→ 把動畫狀態復原，避免卡在擴散畫面
  useEffect(() => {
    if (!pending) {
      setPicked(null);
      setFlood(null);
    }
  }, [pending]);

  const choose = (e, m) => {
    if (!m.enabled || picked) return; // 動畫播放中不重複觸發

    // 算出被點按鈕的中心（相對整個手機框）當作擴散原點
    const dash = e.currentTarget.closest(".dash");
    const d = dash.getBoundingClientRect();
    const b = e.currentTarget.getBoundingClientRect();

    setPicked(m.id);
    setFlood({
      color: m.flood,
      x: b.left - d.left + b.width / 2,
      y: b.top - d.top + b.height / 2,
    });
    // 等顏色鋪滿畫面後才真的切換模式
    setTimeout(() => onSelect(m.id), 560);
  };

  return (
    <div className="dash home2" style={{ backgroundImage: `url(${bgImg})` }}>
      {flood && (
        <span
          className="mode-flood"
          style={{ left: flood.x, top: flood.y, background: flood.color }}
        />
      )}

      <BleConnectPanel />


      <div className="home2-head">
        <h1 className="home2-title">E-bike 模式選擇</h1>
        <div className="home2-divider">
          <span className="hl" />
          <span className="hbike">🚲</span>
          <span className="hl" />
        </div>
      </div>

      <div className="home2-modes">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            className={[
              "mode-orb",
              picked === m.id ? "picked" : "",
              picked && picked !== m.id ? "dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={!m.enabled}
            aria-label={m.label}
            style={{
              "--accent": m.accent,
              "--delay": `${0.18 + i * 0.12}s`,
            }}
            onClick={(e) => choose(e, m)}
          >
            {m.img ? (
              <img className="orb-img" src={m.img} alt={m.label} draggable="false" />
            ) : (
              <span className="orb-emoji" aria-hidden="true">{m.emoji}</span>
            )}
            {m.labelBelow && <span className="orb-label">{m.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
