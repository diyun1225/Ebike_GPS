import { useEffect, useRef, useState } from "react";
import { zoneFromHr, decide, nextGear, RAMP_INTERVAL_MS } from "./decision.js";
import { fiToPct } from "../../ble/vitalsBle.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => Math.random() * (b - a) + a;

// 沒有真實感測器時，用這個固定強度(0~1)驅動模擬。
// 之後接上心跳帶 / 呼吸帶，就把下面的 hr / rr 換成感測器實測值即可。
const RIDE_EFFORT = 0.4;

// demo 模式的三個強度帶（%HRR 目標）：低 / 中 / 高，讓區間隨機跳動
const DEMO_BANDS = [
  [0.30, 0.38], // 低強度（< 40% HRR）
  [0.43, 0.57], // 中強度（40–59%）
  [0.63, 0.85], // 高強度（≥ 60%）
];

// 心肺模式引擎：模擬「每秒一筆生理訊號」並跑流程圖的判定
// demoBand：null=關閉、-1=隨機循環、0/1/2=固定低/中/高強度。
// 指定固定強度時會「直接」跳到該區間，方便 demo 直接切換低中高。
// sensor：即時生理量測 { hr, rr, fi }（null 或 hr 為 null = 無真實感測）。
// realOnly：true = 只用真實資料——沒收到 hr 時「不跑模擬」，回報 { waiting: true }
//           讓畫面顯示等待狀態；false = 現狀（沒真值就退回模擬曲線）。
export function useHeartRateEngine(base, demoBand = null, sensor = null, realOnly = false) {
  const [live, setLive] = useState(null);
  const stateRef = useRef(null);
  const demoRef = useRef(demoBand);
  demoRef.current = demoBand; // 讓計時器內永遠讀到最新的 demo 設定
  const sensorRef = useRef(sensor);
  sensorRef.current = sensor; // 同上，計時器內永遠讀到最新的感測值
  const realOnlyRef = useRef(realOnly);
  realOnlyRef.current = realOnly;

  useEffect(() => {
    if (!base) return;

    stateRef.current = {
      hr: base.restingHr + 0.35 * base.hrr,
      rr: 16,
      rrHist: [], // 每秒一筆 RR，用來算 5 秒內變化量
      rrHighDur: 0, // RR > 25 已持續幾秒
      fatigue: 0, // 目前疲勞度 0~100（模擬；之後改吃組員藍牙傳來的值）
      gear: 1, // 目前輔助力段數
      tick: 0,
      effortTarget: RIDE_EFFORT, // 目前出力目標（demo 時會換）
      effortHold: 0, // 這個目標還要撐幾個 tick
      lastBand: null, // 上一輪的 demo 帶，用來偵測切換
      speed: 20, // demo 車速（km/h）
      cadence: 70, // demo 踏頻（rpm）
      batt: 85, // demo 電池電量（%）
    };

    const id = setInterval(() => {
      const s = stateRef.current;
      s.tick++;
      const fullSecond = s.tick % 2 === 0; // 500ms 迴圈：每 2 tick = 1 秒

      const db = demoRef.current;
      const sen = sensorRef.current;
      const hasReal = sen && sen.hr != null;
      // 已收到真實生理量測且非 demo → 直接吃真實 hr/rr/fi，不再模擬
      const useReal = db == null && hasReal;

      // 「只用真實資料」且還沒收到 hr → 不推進模擬，回報「無數據」狀態：
      // 畫面照常顯示圖表，數值全部給 null（UI 以「—」呈現），不跑模擬曲線。
      if (realOnlyRef.current && db == null && !hasReal) {
        setLive({
          waiting: true, // 尚未收到毫米波心率（畫面用來標示來源狀態）
          real: false,
          hr: null,
          rr: null,
          dRR: null,
          rrHighDur: 0,
          fatigue: null,
          zone: null,
          intensity: null,
          state: null,
          note: null,
          mode: null,
          gear: null,
          tele: null,
        });
        return;
      }

      let tele = null; // 模擬時的車輛數據；真實模式為 null（改用真車 data）

      if (useReal) {
        // ── 真實感測（毫米波）──：hr/rr 直接採用，fi→疲勞度
        // 只用「生理絕對範圍」夾極端值；不要用基準線夾——
        // 若使用者基準線填偏（例：安靜心率填 80、實測 65），會把真值改掉，畫面變假數據。
        s.hr = clamp(sen.hr, 30, 220);
        if (sen.rr != null) s.rr = clamp(sen.rr, 4, 60);
        if (fullSecond) {
          s.rrHist.push(s.rr);
          if (s.rrHist.length > 6) s.rrHist.shift(); // 保留約 5 秒
          s.rrHighDur = s.rr > 25 ? s.rrHighDur + 1 : 0;
        }
        if (sen.fi != null) s.fatigue = fiToPct(sen.fi) ?? s.fatigue;
      } else {
        // ── 模擬（demo，或尚未接感測器時的 fallback）──
        // 切換到指定的低/中/高強度時 → 直接把心率拉到該區間中央
        if (db !== s.lastBand) {
          s.lastBand = db;
          if (db != null && db >= 0) {
            const [lo, hi] = DEMO_BANDS[db];
            const mid = (lo + hi) / 2;
            s.hr = base.restingHr + mid * base.hrr;
            s.rr = 12 + mid * 24;
            s.effortTarget = mid;
            s.effortHold = 0;
          }
        }
        if (db == null) {
          s.effortTarget = RIDE_EFFORT; // 關閉：回到固定強度
        } else if (db === -1) {
          // 隨機循環：撐一段時間後換一個低/中/高帶
          if (s.effortHold <= 0) {
            const [lo, hi] = DEMO_BANDS[Math.floor(Math.random() * DEMO_BANDS.length)];
            s.effortTarget = rand(lo, hi);
            s.effortHold = Math.round(rand(8, 16)); // 約 4~8 秒
          }
          s.effortHold--;
        } else {
          // 固定低/中/高：在該帶內小幅抖動，維持在該區間
          if (s.effortHold <= 0) {
            const [lo, hi] = DEMO_BANDS[db];
            s.effortTarget = rand(lo, hi);
            s.effortHold = Math.round(rand(4, 8));
          }
          s.effortHold--;
        }
        const effort = s.effortTarget;

        if (fullSecond) {
          // 心率朝目標靠攏（有生理延遲），目標 = 安靜 + 出力 × HRR
          const hrTarget = base.restingHr + effort * base.hrr;
          s.hr = clamp(
            s.hr + (hrTarget - s.hr) * 0.18 + rand(-1.5, 1.5),
            base.restingHr - 2,
            base.maxHr
          );
          // 呼吸率：隨出力 12→36，反應比心率快
          const rrTarget = 12 + effort * 24;
          s.rr = clamp(s.rr + (rrTarget - s.rr) * 0.3 + rand(-1.5, 1.5), 8, 46);

          s.rrHist.push(s.rr);
          if (s.rrHist.length > 6) s.rrHist.shift(); // 保留約 5 秒
          s.rrHighDur = s.rr > 25 ? s.rrHighDur + 1 : 0;

          // 疲勞度：強度高於門檻就累積、低於門檻則慢慢恢復（模擬）
          const load = clamp((s.hr - base.restingHr) / base.hrr, 0, 1);
          s.fatigue = clamp(s.fatigue + (load - 0.35) * 1.2, 0, 100);

          // demo 車輛數據：車速/踏頻跟著強度走（低→高越騎越快），電池慢慢掉
          const spdTarget = 8 + effort * 34; // 低≈18、高≈35 km/h
          s.speed = clamp(s.speed + (spdTarget - s.speed) * 0.25 + rand(-1, 1), 0, 50);
          const cadTarget = 45 + effort * 55; // 低≈65、高≈95 rpm
          s.cadence = clamp(s.cadence + (cadTarget - s.cadence) * 0.3 + rand(-2, 2), 0, 120);
          s.batt = clamp(s.batt - (0.05 + effort * 0.1), 0, 100); // 越用力掉越快
        }
        tele = {
          speedKph: +s.speed.toFixed(1),
          cadenceRpm: Math.round(s.cadence),
          batterySocPct: Math.round(s.batt),
        };
      }

      // ── ΔRR + 區間判定 + 決策 + 段數更新（真實 / 模擬共用）──
      const hist = s.rrHist;
      const past = hist.length ? hist[0] : s.rr;
      const dRR = s.rr - past;

      const zone = zoneFromHr(s.hr, base);
      const dir = decide({ zone, rr: s.rr, dRR, rrHighDur: s.rrHighDur });
      s.gear = nextGear(s.gear, dir);

      setLive({
        hr: Math.round(s.hr),
        rr: Math.round(s.rr),
        dRR: +dRR.toFixed(1),
        rrHighDur: s.rrHighDur,
        fatigue: Math.round(s.fatigue), // 目前疲勞度 0~100
        zone,
        intensity: (s.hr - base.restingHr) / base.hrr,
        state: dir.state,
        note: dir.note,
        mode: dir.mode,
        gear: s.gear, // 輔助力段數 1~5，6=無；HeartRateMode 用 ble.setAssist 送真車控制
        real: useReal, // 是否吃真實感測（畫面可據此標示）
        tele, // 模擬車輛數據；真實模式為 null（改用真車 data）
      });
    }, RAMP_INTERVAL_MS);

    return () => clearInterval(id);
  }, [base]);

  return { live };
}
