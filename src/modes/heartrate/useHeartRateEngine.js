import { useEffect, useRef, useState } from "react";
import { zoneFromHr, decide, nextMotorPct, RAMP_INTERVAL_MS } from "./decision.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => Math.random() * (b - a) + a;

// 心率模式引擎：模擬「每秒一筆生理訊號」並跑流程圖的判定
// 之後可把 stateRef 裡的 hr/rr 換成真實感測器（心跳帶 / 呼吸帶）資料
export function useHeartRateEngine(base) {
  const [live, setLive] = useState(null);
  const effortRef = useRef(0.35); // 0~1：騎士當下出力（驅動心率 / 呼吸）
  const stateRef = useRef(null);

  // 外部用按鈕調整出力強度
  const setEffort = (e) => {
    effortRef.current = clamp(e, 0, 1);
  };

  useEffect(() => {
    if (!base) return;

    stateRef.current = {
      hr: base.restingHr + 0.35 * base.hrr,
      rr: 16,
      rrHist: [], // 每秒一筆 RR，用來算 5 秒內變化量
      rrHighDur: 0, // RR > 25 已持續幾秒
      motorPct: 20,
      tick: 0,
    };

    const id = setInterval(() => {
      const s = stateRef.current;
      s.tick++;
      const fullSecond = s.tick % 2 === 0; // 500ms 迴圈：每 2 tick = 1 秒
      const effort = effortRef.current;

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
      }

      // ΔRR：相對約 5 秒前
      const hist = s.rrHist;
      const past = hist.length ? hist[0] : s.rr;
      const dRR = s.rr - past;

      // 區間判定 + 決策 + 馬達更新（每 0.5 秒）
      const zone = zoneFromHr(s.hr, base);
      const dir = decide({ zone, rr: s.rr, dRR, rrHighDur: s.rrHighDur });
      s.motorPct = nextMotorPct(s.motorPct, dir);

      setLive({
        hr: Math.round(s.hr),
        rr: Math.round(s.rr),
        dRR: +dRR.toFixed(1),
        rrHighDur: s.rrHighDur,
        zone,
        intensity: (s.hr - base.restingHr) / base.hrr,
        state: dir.state,
        note: dir.note,
        motor: dir.motor,
        motorMode: dir.motorMode,
        motorPct: Math.round(s.motorPct),
        effort,
      });
    }, RAMP_INTERVAL_MS);

    return () => clearInterval(id);
  }, [base]);

  return { live, setEffort };
}
