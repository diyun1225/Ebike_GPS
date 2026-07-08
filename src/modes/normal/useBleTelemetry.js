import { useCallback, useEffect, useRef, useState } from "react";
import { ccpaBleConnect } from "./ble/ccpaBle.js";
import { parseModeAck } from "../../modeFrame.js";

/*
 * useBleTelemetry — 把 Web Bluetooth 連線包成 React hook。
 *
 *   const { phase, status, data, error, logLines, rawLines,
 *           connect, disconnect, clearLog } = useBleTelemetry();
 *
 *   phase   : "idle" | "connecting" | "connected"  → 給 UI 判斷按鈕狀態
 *   status  : 目前狀態文字（掃描中/連線中/已連線/已斷線…）
 *   data    : 最新一筆解碼快照（CcpaDecoder.snapshot()），還沒資料時為 null
 *   error   : 連線失敗訊息（使用者取消掃描不算錯誤）
 *   connect : 開始連線（務必由使用者點擊觸發，Web Bluetooth 規定）
 *   disconnect : 主動斷線
 *
 * 效能重點：封包可能每秒數十筆進來。若「每收一筆就 setState」，React 會被迫
 * 每筆都重繪（尤其診斷面板的大 <pre>），主執行緒被塞爆 → BLE 事件排隊 →
 * 看起來像「收得很慢」。所以這裡把資料先收進 ref（幾乎零成本），再用一個
 * 固定頻率的計時器把 ref 刷進 state，UI 更新頻率與收封包頻率脫鉤。
 */

// 現在時間字串（HH:MM:SS），只做顯示用
function nowStr() {
  return new Date().toLocaleTimeString();
}

const UI_REFRESH_MS = 200; // UI 刷新頻率（5Hz）；收封包本身不受此限制
const MAX_LOG = 300;
const MAX_RAW = 200;

export function useBleTelemetry() {
  const [phase, setPhase] = useState("idle");
  const [status, setStatus] = useState("尚未連線");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [logLines, setLogLines] = useState([]); // 診斷 log（最新在最上面）
  const [rawLines, setRawLines] = useState([]); // 原始封包（最新在最上面）
  const [canControl, setCanControl] = useState(false); // 是否能送控制指令（有 RX 特徵）
  const [commandedAssist, setCommandedAssist] = useState(null); // 最後一次設定的助力段位（畫面回饋）
  const [commandedSuspension, setCommandedSuspension] = useState(null); // 最後一次設定的避震段（畫面回饋，暫無遙測）
  const [isDemo, setIsDemo] = useState(false); // 是否在跑「模擬資料」（沒真車時預覽畫面用）

  const connRef = useRef(null);
  const ackWaitersRef = useRef([]); // 等待 MODEACK 的 promise resolver 清單
  const demoRef = useRef(null); // 模擬資料的計時器 id
  const demoAssistRef = useRef(3); // 模擬時的助力段位（讓按段位鈕看得到變化）

  // 高速資料先進這些 ref（notify handler 只做這件事，不碰 React）
  const logBufRef = useRef([]);
  const rawBufRef = useRef([]);
  const snapRef = useRef(null);
  const dirtyRef = useRef(false); // 有新資料才刷 UI，沒動就不重繪
  const timerRef = useRef(null);

  const startFlush = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setData(snapRef.current);
      setLogLines(logBufRef.current.slice()); // 複製出新陣列參考，觸發重繪
      setRawLines(rawBufRef.current.slice());
    }, UI_REFRESH_MS);
  }, []);

  const stopFlush = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearLog = useCallback(() => {
    logBufRef.current = [];
    rawBufRef.current = [];
    setLogLines([]);
    setRawLines([]);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    startFlush(); // 連線過程的 ①~⑥ log 也靠這個計時器刷出來
    try {
      const conn = await ccpaBleConnect({
        onStatus: (t) => {
          setStatus(t);
          if (t === "已斷線") {
            setPhase("idle");
            stopFlush();
          }
        },
        onLog: (msg) => {
          console.log("[BLE]", msg); // 桌面 Chrome 也能在 console 看
          const buf = logBufRef.current;
          buf.unshift(`[${nowStr()}] ${msg}`);
          if (buf.length > MAX_LOG) buf.length = MAX_LOG;
          dirtyRef.current = true;
        },
        onRaw: (line) => {
          console.log("[BLE raw]", line); // console 保留完整逐筆
          const buf = rawBufRef.current;
          buf.unshift(line);
          if (buf.length > MAX_RAW) buf.length = MAX_RAW;
          dirtyRef.current = true;
        },
        onData: (snap) => {
          snapRef.current = snap; // 只記最新，UI 由計時器統一刷
          dirtyRef.current = true;
        },
        onFrame: (f) => {
          // 收到 MODEACK → 喚醒對應的等待者（模式碼相符，或不指定碼的都算）
          const ack = parseModeAck(f);
          if (!ack) return;
          ackWaitersRef.current = ackWaitersRef.current.filter((w) => {
            if (w.code == null || w.code === ack.code) {
              clearTimeout(w.timer);
              w.resolve(ack.ok);
              return false; // 移除已喚醒的
            }
            return true;
          });
        },
      });
      connRef.current = conn;
      setCanControl(!!conn.canControl);
      setPhase("connected");
    } catch (e) {
      // 使用者在裝置選擇視窗按取消 → NotFoundError，不當作錯誤
      if (e && e.name === "NotFoundError") {
        setStatus("已取消");
      } else {
        setError(e?.message || String(e));
        setStatus("連線失敗");
      }
      setPhase("idle");
      stopFlush();
    }
  }, [startFlush, stopFlush]);

  const disconnect = useCallback(() => {
    // 若在跑模擬資料，一併停掉
    if (demoRef.current != null) {
      clearInterval(demoRef.current);
      demoRef.current = null;
    }
    setIsDemo(false);
    connRef.current?.disconnect();
    connRef.current = null;
    setPhase("idle");
    setStatus("已斷線");
    setCanControl(false);
    setCommandedAssist(null);
    // 斷線時把還在等 ACK 的都收掉（當作沒收到），避免懸而未決
    ackWaitersRef.current.forEach((w) => {
      clearTimeout(w.timer);
      w.resolve(false);
    });
    ackWaitersRef.current = [];
    stopFlush();
  }, [stopFlush]);

  // 停掉模擬資料
  const stopDemo = useCallback(() => {
    if (demoRef.current != null) {
      clearInterval(demoRef.current);
      demoRef.current = null;
    }
    setIsDemo(false);
  }, []);

  // 開始模擬資料：不連真車，用假的遙測快照餵給所有模式（純預覽畫面用）。
  // 值會平滑變動（sin 波 + 小抖動），連疲勞值也一起給，讓一般/心肺模式都活起來。
  const startDemo = useCallback(() => {
    if (demoRef.current != null) return;
    setError(null);
    setPhase("connected");
    setStatus("模擬資料");
    setCanControl(true);
    setIsDemo(true);
    demoAssistRef.current = 3;
    setCommandedAssist(3);

    let t = 0;
    const wave = (period, amp, base) =>
      base + amp * Math.sin((t / period) * Math.PI * 2);
    const jit = (n) => (Math.random() - 0.5) * n; // 小抖動，看起來像真的
    const gen = () => {
      t += 1;
      const speed = Math.max(0, wave(24, 9, 22) + jit(1.5));
      const fatigue = Math.max(0, Math.min(100, Math.round(wave(80, 30, 45))));
      const fatigueAdvice =
        fatigue >= 70 ? "已進入疲勞區，建議放慢或休息" : fatigue >= 40 ? "強度偏高，注意配速" : "";
      setData({
        speedKph: +speed.toFixed(1),
        cadenceRpm: Math.max(0, Math.round(wave(18, 22, 74) + jit(3))),
        torqueNm: +Math.max(0, wave(16, 12, 18) + jit(2)).toFixed(1),
        motorRpm: Math.max(0, Math.round(wave(20, 320, 1500) + jit(40))),
        motorTempC: Math.round(wave(120, 8, 47)),
        assistLevel: demoAssistRef.current,
        batterySocPct: Math.max(5, Math.round(82 - t / 25)),
        batteryVoltageMv: Math.round(wave(60, 700, 36500)),
        batteryCurrentMa: Math.max(0, Math.round(wave(16, 4000, 8000) + jit(500))),
        batteryTempsC: [Math.round(wave(90, 3, 32)), Math.round(wave(110, 3, 33))],
        rearGear: { index: 1 + (Math.floor(t / 8) % 10), max: 10 },
        fatigue,
        fatigueAdvice,
        hr: Math.round(wave(40, 22, 128) + jit(3)), // 心率 bpm
        rr: Math.round(wave(36, 6, 22) + jit(1)), // 呼吸率 次/分
      });
    };
    gen(); // 立刻先給一筆，不用等 500ms
    demoRef.current = setInterval(gen, 500);
  }, []);

  // 送一行控制指令；失敗只記到診斷 log，不中斷連線
  const sendCommand = useCallback(async (cmd) => {
    try {
      await connRef.current?.sendCommand(cmd);
    } catch (e) {
      const buf = logBufRef.current;
      buf.unshift(`[${nowStr()}] ✗ 送指令失敗：${e?.message || e}`);
      dirtyRef.current = true;
    }
  }, []);

  // 等 AI 板回 MODEACK。code=期望的模式碼（傳 null 表示任何 ACK 都算）。
  // 逾時（預設 2.5s）沒收到 → resolve(false)，不會卡住流程。
  const waitForModeAck = useCallback((code = null, timeoutMs = 2500) => {
    return new Promise((resolve) => {
      const w = { code, resolve, timer: null };
      w.timer = setTimeout(() => {
        ackWaitersRef.current = ackWaitersRef.current.filter((x) => x !== w);
        resolve(false); // 逾時視為沒收到 ACK
      }, timeoutMs);
      ackWaitersRef.current.push(w);
    });
  }, []);

  // 變速：升檔 / 降檔
  const shiftUp = useCallback(() => sendCommand("SHIFT,UP"), [sendCommand]);
  const shiftDown = useCallback(() => sendCommand("SHIFT,DOWN"), [sendCommand]);

  // 助力段位 0~5（韌體 control_set_assist_level 收 0~5）
  const setAssist = useCallback(
    (level) => {
      setCommandedAssist(level); // 這台車不回報段位，用它當畫面回饋
      demoAssistRef.current = level; // 模擬模式下讓 assistLevel 也跟著變
      sendCommand("ASSIST," + level);
    },
    [sendCommand]
  );

  // 避震軟硬 0~5（0 最軟、5 最硬）。
  // TODO(韌體)：沿用 SHIFT/ASSIST 的字串指令慣例送 "SUSP,<0-5>"，待 AI 板加上
  //   對應處理後即生效；車輛也尚未回報避震狀態，故畫面用 commandedSuspension 回饋。
  const setSuspension = useCallback(
    (level) => {
      setCommandedSuspension(level);
      sendCommand("SUSP," + level);
    },
    [sendCommand]
  );

  // 離開頁面/卸載時自動斷線、停掉計時器，避免佔用連線
  useEffect(() => {
    return () => {
      stopFlush();
      if (demoRef.current != null) clearInterval(demoRef.current);
      connRef.current?.disconnect();
    };
  }, [stopFlush]);

  return {
    phase,
    status,
    data,
    error,
    logLines,
    rawLines,
    connect,
    disconnect,
    clearLog,
    canControl,
    commandedAssist,
    commandedSuspension,
    sendCommand,
    waitForModeAck,
    shiftUp,
    shiftDown,
    setAssist,
    setSuspension,
    isDemo,
    startDemo,
    stopDemo,
  };
}
