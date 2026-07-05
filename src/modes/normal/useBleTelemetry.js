import { useCallback, useEffect, useRef, useState } from "react";
import { ccpaBleConnect } from "./ble/ccpaBle.js";

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

  const connRef = useRef(null);

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
    connRef.current?.disconnect();
    connRef.current = null;
    setPhase("idle");
    setStatus("已斷線");
    setCanControl(false);
    setCommandedAssist(null);
    stopFlush();
  }, [stopFlush]);

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

  // 變速：升檔 / 降檔
  const shiftUp = useCallback(() => sendCommand("SHIFT,UP"), [sendCommand]);
  const shiftDown = useCallback(() => sendCommand("SHIFT,DOWN"), [sendCommand]);

  // 助力段位 0~5（韌體 control_set_assist_level 收 0~5）
  const setAssist = useCallback(
    (level) => {
      setCommandedAssist(level); // 這台車不回報段位，用它當畫面回饋
      sendCommand("ASSIST," + level);
    },
    [sendCommand]
  );

  // 離開頁面/卸載時自動斷線、停掉計時器，避免佔用連線
  useEffect(() => {
    return () => {
      stopFlush();
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
    sendCommand,
    shiftUp,
    shiftDown,
    setAssist,
  };
}
