import { useState } from "react";
import HomeScreen from "./HomeScreen.jsx";
import NormalMode from "./modes/normal/NormalMode.jsx";
import NavigationMode from "./modes/navigation/NavigationMode.jsx";
import HeartRateMode from "./modes/heartrate/HeartRateMode.jsx";
import AssistMode from "./modes/assist/AssistMode.jsx";
import { BleProvider, useBle } from "./ble/BleContext.jsx";
import { modeIdToFrame, MODE_LABEL_BY_ID } from "./modeFrame.js";
import RideControls from "./controls/RideControls.jsx";

// 整個 App 的最上層：用 BleProvider 讓全 App 共用「一條」與運算板的 BLE 連線，
// 再在 AppInner 處理「選模式 → 確認 → 送 MODEREQ → 進入」的流程。
//
// 註：這裡「不等」板子回 ACK。AI 板切模式時要載入模型，回覆可能慢到十幾秒，
//     等 ACK 會讓使用者一直卡在「連接失敗」的假錯誤（實際上模式有切成功）。
//     ACK 仍然有收、有解析，只是改成寫進診斷 Log 供對照，不擋畫面。
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
  const requestEnter = (modeId) => setPending(modeId);
  const cancelEnter = () => setPending(null);
  const enterNow = (modeId) => {
    setPending(null);
    setMode(modeId);
  };

  // 按「確定」：連線中就送 MODEREQ 通知板子，然後「立刻」進入，不等 ACK。
  // （板子載入模型可能要十幾秒才回 ACK，等它會變成假的「連接失敗」。）
  const confirmEnter = () => {
    const modeId = pending;
    const frame = modeIdToFrame(modeId);
    const canSend = ble.phase === "connected" && ble.canControl && frame;

    if (canSend) {
      // 不 await：BLE 寫入本身很快，但萬一卡住也不該擋住進入模式。
      // sendCommand 內部已經 try/catch，這裡再兜一層保險。
      Promise.resolve(ble.sendCommand(frame.tx)).catch(() => {});
    }
    enterNow(modeId);
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
          connected={ble.phase === "connected" && ble.canControl}
          onConfirm={confirmEnter}
          onCancel={cancelEnter}
        />
      )}
    </div>
  );
}

// 進入模式的確認視窗：按確定就送封包並立刻進入（不等板子 ACK，見上方說明）
function EnterModal({ modeId, connected, onConfirm, onCancel }) {
  const label = MODE_LABEL_BY_ID[modeId] || "此模式";

  return (
    <div className="enter-modal-backdrop" onClick={onCancel}>
      <div className="enter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="enter-modal-icon">🚴</div>
        <h3>
          確定要進入「{label}」？
        </h3>
        <p className="enter-modal-sub">
          {connected
            ? "進入後會通知運算板切換模式。"
            : "尚未連線藍牙，將直接進入（不會通知運算板）。"}
        </p>

        <div className="enter-modal-actions">
          <button className="enter-btn cancel" onClick={onCancel}>
            取消
          </button>
          <button className="enter-btn ok" onClick={onConfirm}>
            確定
          </button>
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
