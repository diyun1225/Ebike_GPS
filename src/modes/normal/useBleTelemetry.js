import { useCallback, useEffect, useRef, useState } from "react";
import { ccpaBleConnect } from "./ble/ccpaBle.js";
import { parseModeAck, parseModeState } from "../../modeFrame.js";

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

// 助力控制 ACK（車→host，送 0x2940015 後回覆）。Response Code 在 byte0 的 bit4~7。
// 這台車段位無法直接讀回，靠這個確認有沒有被採納。
const ASSISTACK_ID = 0x2940014;
// TODO(韌體)：指令表值(hex)欄是「-」，成功碼尚未給定；先把收到的 code 記到診斷 log，
//   ASSIST_ACK_SUCCESS 確認後填正確值即可讓「已採納」判定生效。
const ASSIST_ACK_SUCCESS = 0x1;

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
  const [assistAck, setAssistAck] = useState(null); // 最後一次助力 ACK { code, ok }
  const [vitals, setVitals] = useState({ hr: null, rr: null, fi: null }); // 毫米波生理量測（走單車 TX 的 JSON 行）
  const [modeState, setModeState] = useState(null); // AI 板廣播的「目前生效模式」(1~3)，沒收到為 null

  const connRef = useRef(null);
  // 連線世代：按「取消」就 +1，讓還在進行中的那次 connect 結果全部作廢。
  // （瀏覽器取消裝置選擇器時，requestDevice 有時不會 reject，promise 就一直吊著，
  //   畫面會卡在「連線中…」。有了世代碼，取消後即使它稍後才回來也不會蓋掉狀態。）
  const genRef = useRef(0);
  const ackWaitersRef = useRef([]); // 等待 MODEACK 的 promise resolver 清單
  const vitalsRef = useRef({ hr: null, rr: null, fi: null }); // 生理量測先進 ref，再由計時器刷進 state
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
      setVitals({ ...vitalsRef.current });
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
    const gen = ++genRef.current; // 這次連線的世代碼
    const stale = () => genRef.current !== gen; // 期間被取消 / 重按 → 這次作廢
    setError(null);
    setPhase("connecting");
    snapRef.current = null; // 清掉上一段連線的殘值，避免沿用到舊車況
    startFlush(); // 連線過程的 ①~⑥ log 也靠這個計時器刷出來
    try {
      const conn = await ccpaBleConnect({
        onStatus: (t) => {
          if (stale()) return;
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
          // 抗閃爍：車子偶爾會送無效值（例：SOC=0x00/0xFF → 該欄位這包為 null）。
          // 若直接刷進去，畫面會在「數字 ↔ --」之間跳。這裡沿用上一筆的有效值：
          // 只有「這次是 null 但上一筆有值」的欄位保留舊值，其餘照新值。
          const prev = snapRef.current;
          if (prev) {
            const merged = { ...snap };
            for (const k in snap) {
              if (snap[k] == null && prev[k] != null) merged[k] = prev[k];
            }
            snapRef.current = merged;
          } else {
            snapRef.current = snap;
          }
          dirtyRef.current = true;
        },
        onVitals: (v) => {
          // 毫米波 JSON（hr/rr/fi）走單車 TX 進來。這包沒帶到的欄位保留上一次的值。
          const cur = vitalsRef.current;
          vitalsRef.current = {
            hr: v.hr != null ? v.hr : cur.hr,
            rr: v.rr != null ? v.rr : cur.rr,
            fi: v.fi != null ? v.fi : cur.fi,
          };
          dirtyRef.current = true;
        },
        onFrame: (f) => {
          // 助力 ACK（0x2940014）：送 ASSIST 後車端回覆，Response Code 在 byte0 bit4~7。
          if (f && f.id === ASSISTACK_ID) {
            const code = ((f.data?.[0] ?? 0) >> 4) & 0x0f;
            const okAck = code === ASSIST_ACK_SUCCESS;
            setAssistAck({ code, ok: okAck });
            logBufRef.current.unshift(
              `[${nowStr()}] ${okAck ? "✓" : "•"} 助力 ACK code=0x${code
                .toString(16)
                .toUpperCase()}`
            );
            if (logBufRef.current.length > MAX_LOG) logBufRef.current.length = MAX_LOG;
            dirtyRef.current = true;
            return;
          }

          // 喚醒符合條件的模式等待者（pred 決定哪些等待者算數）
          const settle = (pred, ok) => {
            ackWaitersRef.current = ackWaitersRef.current.filter((w) => {
              if (!pred(w)) return true;
              clearTimeout(w.timer);
              w.resolve(ok);
              return false; // 移除已喚醒的
            });
          };

          // ① 模式狀態廣播 0x1FA23001：AI 板每秒回報「目前生效模式」。
          //    廣播已經是目標模式 → 直接視為切換成功。這反映板子的實際狀態，
          //    比「板子說它收到了」更有保證，所以擺在 ACK 前面判。
          const st = parseModeState(f);
          if (st) {
            if (st.mode > 0) {
              setModeState(st.mode); // 同值 React 會自行跳過重繪，1Hz 不影響效能
              settle((w) => w.code === st.mode, true);
            }
            return;
          }

          // ② 模式切換 ACK 0x1FA13001：對「這次 SET_MODE」的回覆（0xA5 + 模式碼）。
          const ack = parseModeAck(f);
          if (!ack) return;
          logBufRef.current.unshift(
            `[${nowStr()}] ${ack.ok ? "✓" : "✗"} 模式 ACK ok=${ack.ok} 回音=${
              ack.echo < 0 ? "(無 byte1)" : ack.echo
            }`
          );
          if (logBufRef.current.length > MAX_LOG) logBufRef.current.length = MAX_LOG;
          dirtyRef.current = true;
          // 回音相符最理想；板子沒帶 byte1（DLC=1）時也接受——
          // 0x1FA13001 這個 ID 只有模式 ACK 在用，且同時間只會有一個等待者。
          settle((w) => w.code == null || ack.echo === w.code || ack.echo < 0, ack.ok);
        },
      });
      // 連上之前就被取消 → 這條連線不要了，直接斷掉，不要更新畫面
      if (stale()) {
        conn.disconnect();
        return;
      }
      connRef.current = conn;
      setCanControl(!!conn.canControl);
      setPhase("connected");
    } catch (e) {
      if (stale()) return; // 已取消：不要用這次的錯誤蓋掉「已取消」狀態
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

  // 取消連線中：讓進行中的那次 connect 作廢，畫面立刻回到「未連線」。
  // 需要它是因為瀏覽器取消裝置選擇器時 promise 可能永遠不會回來。
  const cancelConnect = useCallback(() => {
    genRef.current++;
    connRef.current?.disconnect();
    connRef.current = null;
    setPhase("idle");
    setStatus("已取消");
    setError(null);
    setCanControl(false);
    stopFlush();
  }, [stopFlush]);

  const disconnect = useCallback(() => {
    // 若在跑模擬資料，一併停掉
    if (demoRef.current != null) {
      clearInterval(demoRef.current);
      demoRef.current = null;
    }
    setIsDemo(false);
    genRef.current++; // 主動斷線也讓進行中的連線作廢
    connRef.current?.disconnect();
    connRef.current = null;
    setPhase("idle");
    setStatus("已斷線");
    setCanControl(false);
    setCommandedAssist(null);
    snapRef.current = null; // 清空車況，斷線後畫面回到 --（不停在最後一筆舊數字）
    setData(null);
    vitalsRef.current = { hr: null, rr: null, fi: null }; // 清空生理量測
    setVitals({ hr: null, rr: null, fi: null });
    setModeState(null); // 清空板子模式，斷線後不沿用舊狀態
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

  // 助力段位 0~5：直接組 ASSISTREQ raw CAN（0x2940015）送出，不走韌體的
  // "ASSIST,<n>" 字串簡寫，少一層 ESP32 解析。超出 0~5 不送。
  const setAssist = useCallback(
    (level) => {
      // ⚠️ 一定要送字串 "ASSIST,<0-5>"，交給韌體 control_set_assist_level 組封包。
      // 曾改成由 App 直接組 raw CAN（CAN,2940015,2,02,0X）想少一層解析，
      // 但實車測試「騎起來完全沒感覺」= 車沒吃這帳。ble_phone.html 送字串則正常，
      // 所以以韌體那條路為準，不要再自己組 CAN。
      // 不做「不合法就 return」的檢查——那會靜默不送、很難查。
      // ble_phone.html 是直接把段位接成字串送出，這裡照做，只夾到 0~5。
      const n = Math.round(Number(level));
      if (!Number.isFinite(n)) return;
      const lv = Math.max(0, Math.min(5, n));
      setCommandedAssist(lv); // 這台車不回報段位，用它當畫面回饋
      demoAssistRef.current = lv; // 模擬模式下讓 assistLevel 也跟著變
      sendCommand("ASSIST," + lv);
    },
    [sendCommand]
  );

  // 前叉（避震）軟硬 1~5（1 最軟 0x81 ~ 5 最硬 0x85；0x80 歸零段不開放）。
  // 指令 "FORK,<1-5>"：韌體 control_set_frontfork 組出 0x294003B（byte1=0x80+檔位），
  // 與 BLE/ble_phone.html 的避震按鈕同一條路徑。目前檔位由 0x294003C 回報
  // （見 ccpaDecode 的 fork），畫面以回報值為準、commandedSuspension 當樂觀回饋。
  const setSuspension = useCallback(
    (level) => {
      setCommandedSuspension(level);
      sendCommand("FORK," + level);
    },
    [sendCommand]
  );

  // 電子坐墊（Dropper）：長按解鎖時送 UNLOCK，放開重新上鎖時送 LOCK（0x2940035）
  const unlockSeat = useCallback(() => sendCommand("DROPPER,UNLOCK"), [sendCommand]);
  const lockSeat = useCallback(() => sendCommand("DROPPER,LOCK"), [sendCommand]);

  // 系統關機（0x2940005，SYSTEM,OFF）。⚠️ 不可逆：電池停止供電，需重開機才會回來。
  const systemOff = useCallback(() => sendCommand("SYSTEM,OFF"), [sendCommand]);

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
    cancelConnect,
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
    unlockSeat,
    lockSeat,
    systemOff,
    assistAck,
    vitals,
    modeState, // AI 板廣播的目前生效模式（1~3；沒收到為 null）
    isDemo,
    startDemo,
    stopDemo,
  };
}
