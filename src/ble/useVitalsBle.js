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

export function useVitalsBle() {
  const [phase, setPhase] = useState("idle");
  const [status, setStatus] = useState("尚未連線");
  const [error, setError] = useState(null);
  const [vitals, setVitals] = useState({ hr: null, rr: null, fi: null });

  const connRef = useRef(null);
  const vitalsRef = useRef({ hr: null, rr: null, fi: null });
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);

  const startFlush = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setVitals({ ...vitalsRef.current });
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
        onLog: (m) => console.log("[Pi]", m),
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
    stopFlush();
  }, [stopFlush]);

  useEffect(() => {
    return () => {
      stopFlush();
      connRef.current?.disconnect();
    };
  }, [stopFlush]);

  return { phase, status, error, vitals, connect, disconnect };
}
