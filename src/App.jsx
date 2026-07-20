import { useState } from "react";
import HomeScreen from "./HomeScreen.jsx";
import NormalMode from "./modes/normal/NormalMode.jsx";
import NavigationMode from "./modes/navigation/NavigationMode.jsx";
import HeartRateMode from "./modes/heartrate/HeartRateMode.jsx";
import AssistMode from "./modes/assist/AssistMode.jsx";
import { BleProvider, useBle } from "./ble/BleContext.jsx";
import { modeIdToFrame, MODE_CODE_BY_ID, MODE_LABEL_BY_ID } from "./modeFrame.js";
import RideControls from "./controls/RideControls.jsx";

// 等運算板回 MODEACK 的逾時（ms）。板子回應較慢，給久一點避免誤判逾時。
const MODEACK_TIMEOUT_MS = 8000;

// 整個 App 的最上層：用 BleProvider 讓全 App 共用「一條」與運算板的 BLE 連線，
// 再在 AppInner 處理「選模式 → 確認 → 送 MODEREQ → 等板子 ACK → 進入」的流程。
export default function App() {
  return (
    <BleProvider>
      <AppInner />
    </BleProvider>
  );
}

function AppInner() {
  const ble = useBle();
  const [mode, setMode] = useState(null); // null = 主畫面
  const [pending, setPending] = useState(null); // 待確認進入的 modeId（顯示確認視窗）
  // 送封包 / 等 ACK 的即時狀態
  const [flow, setFlow] = useState({ busy: false, msg: "", error: false });

  // 偵測「頁面被重新載入」：sessionStorage 在同一分頁的 reload 之間會保留。
  // 掛載時旗標已存在 → 這不是第一次開啟，是頁面被重載了（dev 熱更新 / iOS 記憶體不足
  // 自動重載…）。頁面一重載 Web Bluetooth 必斷，用這個橫幅區分「真斷線」還是「被重載」。
  const [reloaded, setReloaded] = useState(() => {
    const hit = sessionStorage.getItem("ebike-booted") === "1";
    sessionStorage.setItem("ebike-booted", "1");
    return hit;
  });

  const backToHome = () => setMode(null);

  // 主畫面點模式 → 先跳確認視窗，還不進入
  const requestEnter = (modeId) => {
    setFlow({ busy: false, msg: "", error: false });
    setPending(modeId);
  };
  const cancelEnter = () => {
    if (flow.busy) return; // 傳送中不讓關
    setPending(null);
  };
  const enterNow = (modeId) => {
    setPending(null);
    setFlow({ busy: false, msg: "", error: false });
    setMode(modeId);
  };

  // 按「確定」：連線中就送 MODEREQ 並等 ACK；沒連線就直接進入（不通知板子）
  const confirmEnter = async () => {
    const modeId = pending;
    const frame = modeIdToFrame(modeId);
    const code = MODE_CODE_BY_ID[modeId];
    const canSend = ble.phase === "connected" && ble.canControl && frame;

    if (!canSend) {
      enterNow(modeId); // 沒連線 / 無法送 → 直接進入
      return;
    }

    try {
      setFlow({ busy: true, msg: "傳送模式指令給運算板…", error: false });
      await ble.sendCommand(frame.tx);
      setFlow({ busy: true, msg: "等待運算板確認（ACK）…", error: false });
      const ok = await ble.waitForModeAck(code, MODEACK_TIMEOUT_MS);
      if (ok) {
        enterNow(modeId); // 收到 ACK → 進入
      } else {
        setFlow({
          busy: false,
          msg: "未收到運算板確認，可重試或直接進入。",
          error: true,
        });
      }
    } catch (e) {
      setFlow({
        busy: false,
        msg: "送出失敗：" + (e?.message || e),
        error: true,
      });
    }
  };

  // 目前畫面
  let screen;
  if (mode === "normal") screen = <NormalMode onBack={backToHome} />;
  else if (mode === "navigation") screen = <NavigationMode onBack={backToHome} />;
  else if (mode === "heartrate") screen = <HeartRateMode onBack={backToHome} />;
  else if (mode === "suspension")
    screen = <ComingSoon title="智慧避震模式" icon="🔧" onBack={backToHome} />;
  else if (mode === "assist") screen = <AssistMode onBack={backToHome} />;
  else if (mode === "shift")
    screen = <ComingSoon title="智慧變速模式" icon="⚙️" onBack={backToHome} />;
  else screen = <HomeScreen onSelect={requestEnter} pending={pending} />;

  return (
    // 手機框：固定成一支手機寬度並置中。浮動元素（小球、視窗）以此為定位基準，
    // 才會貼齊 App 畫面邊緣，而不是整個瀏覽器視窗的邊緣。
    <div className="app-shell">
      {screen}
      {/* 頁面重載警示：出現這條 = 剛剛整頁被重新載入（藍牙因此斷線），不是換模式造成的 */}
      {reloaded && (
        <div className="reload-banner" role="alert">
          <span>⚠ 頁面被重新載入，藍牙已斷線（dev 存檔熱更新或記憶體不足所致）</span>
          <button onClick={() => setReloaded(false)} aria-label="關閉">✕</button>
        </div>
      )}
      {/* 手動控制小球：只在進入某個模式後浮現（主畫面不顯示） */}
      {mode && <RideControls mode={mode} />}
      {pending && (
        <EnterModal
          modeId={pending}
          flow={flow}
          connected={ble.phase === "connected" && ble.canControl}
          onConfirm={confirmEnter}
          onCancel={cancelEnter}
          onEnterAnyway={() => enterNow(pending)}
        />
      )}
    </div>
  );
}

// 進入模式的確認視窗：確定 → 送封包 / 等 ACK；逾時可重試或直接進入
function EnterModal({ modeId, flow, connected, onConfirm, onCancel, onEnterAnyway }) {
  const label = MODE_LABEL_BY_ID[modeId] || "此模式";
  const showRecover = flow.error && !flow.busy; // 逾時/失敗 → 顯示重試/直接進入

  return (
    <div
      className="enter-modal-backdrop"
      onClick={flow.busy ? undefined : onCancel}
    >
      <div className="enter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="enter-modal-icon">🚴</div>
        <h3>
          確定要進入「{label}」？
        </h3>
        <p className="enter-modal-sub">
          {connected
            ? "進入後會通知運算板切換模式，並等待板子確認。"
            : "尚未連線藍牙，將直接進入（不會通知運算板）。"}
        </p>

        {flow.msg && (
          <div className={`enter-modal-status ${flow.error ? "err" : ""}`}>
            {flow.busy && <span className="enter-spin" aria-hidden="true" />}
            <span>{flow.msg}</span>
          </div>
        )}

        <div className="enter-modal-actions">
          {showRecover ? (
            <>
              <button className="enter-btn cancel" onClick={onCancel}>
                取消
              </button>
              <button className="enter-btn ghost" onClick={onEnterAnyway}>
                直接進入
              </button>
              <button className="enter-btn ok" onClick={onConfirm}>
                重試
              </button>
            </>
          ) : (
            <>
              <button
                className="enter-btn cancel"
                onClick={onCancel}
                disabled={flow.busy}
              >
                取消
              </button>
              <button
                className="enter-btn ok"
                onClick={onConfirm}
                disabled={flow.busy}
              >
                {flow.busy ? "處理中…" : "確定"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
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
