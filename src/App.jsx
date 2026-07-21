import { useEffect, useRef, useState } from "react";
import HomeScreen from "./HomeScreen.jsx";
import NormalMode from "./modes/normal/NormalMode.jsx";
import NavigationMode from "./modes/navigation/NavigationMode.jsx";
import HeartRateMode from "./modes/heartrate/HeartRateMode.jsx";
import AssistMode from "./modes/assist/AssistMode.jsx";
import { BleProvider, useBle } from "./ble/BleContext.jsx";
import { modeIdToFrame, MODE_CODE_BY_ID, MODE_LABEL_BY_ID } from "./modeFrame.js";
import RideControls from "./controls/RideControls.jsx";

// 等運算板回 MODEACK 的逾時（ms）。
// AI 板切模式要載入模型，實測可能要十幾秒才回 ACK——逾時抓太短會變成
// 假的「連接失敗」（模式其實有切成功）。這裡給很寬鬆的上限，並且在等待
// 期間就提供「直接進入」，使用者不必等滿也能自己跳過。
const MODEACK_TIMEOUT_MS = 60000;

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
  const [waited, setWaited] = useState(0); // 已等待秒數（讓使用者看得出還活著）
  // 每次按「確定」遞增：等待中若被取消或手動進入，舊的那次 ACK 回來要忽略
  const enterSeqRef = useRef(0);

  // 等待中每秒更新一次計數
  useEffect(() => {
    if (!flow.busy) {
      setWaited(0);
      return;
    }
    const t = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [flow.busy]);

  // 偵測「頁面被重新載入」：sessionStorage 在同一分頁的 reload 之間會保留。
  // 掛載時旗標已存在 → 這不是第一次開啟，是頁面被重載了（dev 熱更新 / iOS 記憶體不足
  // 自動重載…）。頁面一重載 Web Bluetooth 必斷，用這個橫幅區分「真斷線」還是「被重載」。
  const [reloaded, setReloaded] = useState(() => {
    const hit = sessionStorage.getItem("ebike-booted") === "1";
    sessionStorage.setItem("ebike-booted", "1");
    return hit;
  });

  // 離開任何模式回到主畫面 → 通知運算板切回「一般模式」(code 1)。
  // 主畫面本身不屬於任何特殊模式，讓板子回到預設狀態，才不會停在上一個模式
  // （例如智慧輔助還在自動控輔助力）。
  // 不等 ACK：返回動作不該被板子載入模型的時間卡住。
  const backToHome = () => {
    const frame = modeIdToFrame("normal");
    // 與進入模式同一套守門：模擬中沒有真板子，不用送
    const canSend =
      ble.phase === "connected" && ble.canControl && !ble.isDemo && frame;
    if (canSend) Promise.resolve(ble.sendCommand(frame.tx)).catch(() => {});
    setMode(null);
  };

  // 主畫面點模式 → 先跳確認視窗，還不進入
  const requestEnter = (modeId) => {
    setFlow({ busy: false, msg: "", error: false });
    setPending(modeId);
  };
  const cancelEnter = () => {
    enterSeqRef.current++; // 作廢進行中的等待
    setFlow({ busy: false, msg: "", error: false });
    setPending(null);
  };
  const enterNow = (modeId) => {
    enterSeqRef.current++; // 已經進去了，晚到的 ACK 不要再動畫面
    setPending(null);
    setFlow({ busy: false, msg: "", error: false });
    setMode(modeId);
  };

  // 按「確定」：連線中就送 MODEREQ，並等板子回 ACK（收到才進入）。
  // 板子要載入模型，可能十幾秒才回——等待期間畫面轉圈並顯示已等待秒數，
  // 使用者隨時可按「直接進入」跳過，不會被卡住。
  const confirmEnter = async () => {
    const modeId = pending;
    const frame = modeIdToFrame(modeId);
    const code = MODE_CODE_BY_ID[modeId];
    // isDemo 要排除：模擬模式會把 phase/canControl 設成已連線的樣子，但沒有
    // 真板子會回 ACK，等下去只會空轉到逾時。
    const canSend =
      ble.phase === "connected" && ble.canControl && !ble.isDemo && frame;

    if (!canSend) {
      enterNow(modeId); // 沒連線 / 模擬中 / 無法送 → 直接進入
      return;
    }

    const seq = ++enterSeqRef.current;
    setFlow({ busy: true, msg: "運算板載入模型中，請稍候…", error: false });
    // 先掛好等待再送指令，避免板子回太快時 ACK 落在註冊空窗期被錯過
    const ackPromise = ble.waitForModeAck(code, MODEACK_TIMEOUT_MS);
    Promise.resolve(ble.sendCommand(frame.tx)).catch(() => {});

    const ok = await ackPromise;
    if (seq !== enterSeqRef.current) return; // 已被取消 / 使用者自己進去了

    if (ok) {
      enterNow(modeId); // 收到 ACK → 確認板子就緒，進入
    } else {
      // 逾時不代表失敗（模式通常已切成功），所以不套錯誤樣式、不說「失敗」
      setFlow({
        busy: false,
        msg: "還沒收到運算板回覆。模式通常已切換成功，可再等一下或直接進入。",
        error: false,
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
          waited={waited}
          connected={ble.phase === "connected" && ble.canControl}
          onConfirm={confirmEnter}
          onCancel={cancelEnter}
          onEnterAnyway={() => enterNow(pending)}
        />
      )}
    </div>
  );
}

// 進入模式的確認視窗：確定 → 送封包並等板子 ACK（轉圈＋秒數）。
// 等待中與逾時後都提供「直接進入」，不會把使用者卡住。
function EnterModal({ modeId, flow, waited, connected, onConfirm, onCancel, onEnterAnyway }) {
  const label = MODE_LABEL_BY_ID[modeId] || "此模式";
  const timedOut = !flow.busy && !!flow.msg; // 等過但沒收到 → 顯示重試/直接進入

  return (
    <div className="enter-modal-backdrop" onClick={flow.busy ? undefined : onCancel}>
      <div className="enter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="enter-modal-icon">🚴</div>
        <h3>
          確定要進入「{label}」？
        </h3>
        <p className="enter-modal-sub">
          {connected
            ? "進入後會通知運算板切換模式，並等待板子確認就緒。"
            : "尚未連線藍牙，將直接進入（不會通知運算板）。"}
        </p>

        {flow.msg && (
          <div className={`enter-modal-status ${flow.error ? "err" : ""}`}>
            {flow.busy && <span className="enter-spin" aria-hidden="true" />}
            <span>
              {flow.msg}
              {flow.busy && waited > 0 && `（已等待 ${waited} 秒）`}
            </span>
          </div>
        )}

        <div className="enter-modal-actions">
          {flow.busy ? (
            // 等待中：可以取消，也可以不等直接進入
            <>
              <button className="enter-btn cancel" onClick={onCancel}>
                取消
              </button>
              <button className="enter-btn ghost" onClick={onEnterAnyway}>
                直接進入
              </button>
            </>
          ) : timedOut ? (
            <>
              <button className="enter-btn cancel" onClick={onCancel}>
                取消
              </button>
              <button className="enter-btn ghost" onClick={onEnterAnyway}>
                直接進入
              </button>
              <button className="enter-btn ok" onClick={onConfirm}>
                再等等
              </button>
            </>
          ) : (
            <>
              <button className="enter-btn cancel" onClick={onCancel}>
                取消
              </button>
              <button className="enter-btn ok" onClick={onConfirm}>
                確定
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
