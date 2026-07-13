// 兩條 BLE 連線的狀態＋操作列：自行車（車況/控制）與樹莓派（hr/rr/fi 生理量測）。
// 主畫面與各模式共用，連線 UI 才會一致；外層容器樣式由 className 決定
// （主畫面浮在左上角、模式內則排在內容流裡）。
import { useBle } from "./BleContext.jsx";

export default function BleConnectPanel({ className = "home-ble-stack" }) {
  const ble = useBle();
  const connected = ble.phase === "connected";
  const pi = ble.pi; // 第二條連線：樹莓派（生理量測）
  const piConnected = pi?.phase === "connected";

  return (
    <div className={className}>
      {/* 第一條：自行車（車況 + 控制） */}
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
          !connected && (
            <>
              <button
                className="home-ble-btn"
                onClick={ble.connect}
                disabled={ble.phase === "connecting"}
              >
                {ble.phase === "connecting" ? "連線中…" : "連線自行車"}
              </button>
              <button className="home-ble-btn ghost" onClick={ble.startDemo}>
                模擬
              </button>
            </>
          )
        )}
      </div>

      {/* 第二條：樹莓派（心率 HR / 呼吸率 RR / 疲勞值 FI） */}
      <div className={`home-ble ${piConnected ? "on" : ""}`}>
        <span className={`home-ble-dot ${piConnected ? "on" : ""}`} />
        <span className="home-ble-txt">
          {piConnected
            ? "樹莓派已連線"
            : pi?.phase === "connecting"
            ? pi.status || "連線中…"
            : "樹莓派未連線"}
        </span>
        {!piConnected && pi?.phase !== "connecting" && pi?.error && (
          <span className="home-ble-err" title={pi.error}>
            ⚠ {pi.error}
          </span>
        )}
        {piConnected ? (
          <button className="home-ble-btn ghost" onClick={pi.disconnect}>
            斷線
          </button>
        ) : (
          <button
            className="home-ble-btn"
            onClick={pi?.connect}
            disabled={pi?.phase === "connecting"}
          >
            {pi?.phase === "connecting" ? "連線中…" : "連線樹莓派"}
          </button>
        )}
      </div>
    </div>
  );
}
