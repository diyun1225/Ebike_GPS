import { useCallback, useEffect, useRef, useState } from "react";
import { connectVitals } from "./vitalsBle.js";

/*
 * useVitalsBle — 把「樹莓派」（生理量測板）連線包成 React hook。
 *
 *   const { phase, status, error, vitals, connect, disconnect } = useVitalsBle();
 *
 *   phase  : "idle" | "connecting" | "connected"
 *   vitals : { hr, rr, fi }  最新生理量測（還沒收到為 null）
 *   connect: 開始連線（務必由使用者點擊觸發，Web Bluetooth 規定）
 *
 * 與單車 telemetry 相同的效能作法：收到的資料先進 ref，再由固定頻率計時器刷進 state，
 * UI 更新頻率與收封包頻率脫鉤。
 */

const UI_REFRESH_MS = 200; // 5Hz
const MAX_LOG = 200;

// 現在時間字串（HH:MM:SS），只做顯示用
const nowStr = () => new Date().toLocaleTimeString();

export function useVitalsBle() {
  const [phase, setPhase] = useState("idle");
  const [status, setStatus] = useState("尚未連線");
  const [error, setError] = useState(null);
  const [vitals, setVitals] = useState({ hr: null, rr: null, fi: null });
  // 診斷 log：手機（Bluefy）沒有 console，靠這個在畫面上看卡在哪一步
  const [logLines, setLogLines] = useState([]);

  const connRef = useRef(null);
  const vitalsRef = useRef({ hr: null, rr: null, fi: null });
  const logBufRef = useRef([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);

  // 收到的 log 先進 ref，由下方計時器統一刷進 state（避免每筆都重繪）
  const pushLog = useCallback((msg) => {
    console.log("[Pi]", msg);
    const buf = logBufRef.current;
    buf.unshift(`[${nowStr()}] ${msg}`);
    if (buf.length > MAX_LOG) buf.length = MAX_LOG;
    dirtyRef.current = true;
  }, []);

  const clearLog = useCallback(() => {
    logBufRef.current = [];
    setLogLines([]);
  }, []);

  const startFlush = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setVitals({ ...vitalsRef.current });
      setLogLines(logBufRef.current.slice()); // 複製出新參考，觸發重繪
    }, UI_REFRESH_MS);
  }, []);

  const stopFlush = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    startFlush();
    try {
      const conn = await connectVitals({
        onStatus: (t) => {
          setStatus(t);
          if (t === "已斷線") {
            setPhase("idle");
            connRef.current = null;
            stopFlush();
          }
        },
        onVitals: (v) => {
          const cur = vitalsRef.current;
          // 這包沒帶到的欄位保留上一次的值
          vitalsRef.current = {
            hr: v.hr != null ? v.hr : cur.hr,
            rr: v.rr != null ? v.rr : cur.rr,
            fi: v.fi != null ? v.fi : cur.fi,
          };
          dirtyRef.current = true;
        },
        onLog: pushLog,
      });
      connRef.current = conn;
      setPhase("connected");
    } catch (e) {
      // 使用者在裝置選擇視窗按取消 → NotFoundError，不當作錯誤
      if (e && e.name === "NotFoundError") {
        setStatus("已取消");
      } else {
        setError(e?.message || String(e));
        setStatus("連線失敗");
        pushLog("✗ 連線失敗：" + (e?.message || e));
      }
      setPhase("idle");
      setLogLines(logBufRef.current.slice()); // 失敗時計時器已停，手動刷一次才看得到
      stopFlush();
    }
  }, [startFlush, stopFlush, pushLog]);

  const disconnect = useCallback(() => {
    connRef.current?.disconnect();
    connRef.current = null;
    setPhase("idle");
    setStatus("已斷線");
    stopFlush();
  }, [stopFlush]);

  useEffect(() => {
    return () => {
      stopFlush();
      connRef.current?.disconnect();
    };
  }, [stopFlush]);

  return { phase, status, error, vitals, logLines, clearLog, connect, disconnect };
}
