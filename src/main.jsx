import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// 注意：不要用 <React.StrictMode> 包住 App。
// StrictMode 在「開發模式」會把元件 mount→unmount→remount 跑兩遍，
// useBleTelemetry 的 cleanup 會在這個抖動裡呼叫 disconnect()，
// 這會干擾 Web Bluetooth 的裝置選擇視窗（requestDevice 被莫名 cancelled、選單一閃就消失）。
// 純 HTML 版沒有這層，所以 ble_phone.html 正常、React 卻連不上。
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
