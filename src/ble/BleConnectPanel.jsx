// BLE 連線的狀態＋操作列：自行車 / ESP32（車況、控制、生理量測全走這一條）。
// 主畫面與各模式共用，連線 UI 才會一致；外層容器樣式由 className 決定
// （主畫面浮在左上角、模式內則排在內容流裡）。
//
// 註：原本還有第二條「連線樹莓派」，現已移除——改由 ESP32 直接連毫米波，
//     再把 hr/rr 轉成 CAN 0x1FA15000 從這條連線送過來。
import { useBle } from "./BleContext.jsx";

export default function BleConnectPanel({ className = "home-ble-stack" }) {
  const ble = useBle();
  const connected = ble.phase === "connected";

  return (
    <div className={className}>
      {/* 自行車 / ESP32（車況 + 控制 + 生理量測） */}
      <div className={`home-ble ${connected ? "on" : ""}`}>
        <span className={`home-ble-dot ${connected ? "on" : ""}`} />
        <span className="home-ble-txt">
          {ble.isDemo
            ? "模擬資料中"
            : connected
            ? "自行車已連線"
            : ble.phase === "connecting"
            ? ble.status || "連線中…"
            : "自行車未連線"}
        </span>
        {/* 連線失敗/取消時把原因秀出來，否則使用者完全不知道卡在哪 */}
        {!connected && !ble.isDemo && ble.phase !== "connecting" && ble.error && (
          <span className="home-ble-err" title={ble.error}>
            ⚠ {ble.error}
          </span>
        )}
        {ble.isDemo ? (
          <button className="home-ble-btn ghost" onClick={ble.stopDemo}>
            停止
          </button>
        ) : (
          !connected &&
          // 連線中：只給「取消」。裝置選擇器被取消時 promise 可能不會回來，
          // 沒有這顆就會永遠卡在「連線中…」。
          (ble.phase === "connecting" ? (
            <button className="home-ble-btn ghost" onClick={ble.cancelConnect}>
              取消
            </button>
          ) : (
            <>
              <button className="home-ble-btn" onClick={ble.connect}>
                連線自行車
              </button>
              <button className="home-ble-btn ghost" onClick={ble.startDemo}>
                模擬
              </button>
            </>
          ))
        )}
      </div>

    </div>
  );
}
