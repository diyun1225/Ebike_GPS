// 心率模式決策邏輯（對應流程圖）
// 全部是純函式，方便之後單獨測試 / 替換成真實感測器資料

// 馬達輸出檔位
export const MOTOR = {
  LV_LOW: { id: "LV_LOW", pct: 20, label: "LV_LOW" },
  LV_MED: { id: "LV_MED", pct: 50, label: "LV_MED" },
  LV_HIGH: { id: "LV_HIGH", pct: 80, label: "LV_HIGH" },
  LV_BOOST: { id: "LV_BOOST", pct: 80, label: "LV_BOOST" },
};

// 三個心率區間（車錶燈色）
export const ZONES = {
  LOW: { id: "LOW", label: "HR_LOW", name: "低強度", light: "藍燈", color: "#2f7bff" },
  HIGH: { id: "HIGH", label: "HR_HIGH", name: "中強度", light: "綠燈", color: "#1db954" },
  MAX: { id: "MAX", label: "HR_MAX", name: "高強度", light: "橘燈", color: "#ff8a1f" },
};

// [系統啟動] 建立個人化基準線
//   最大心率 = 207 - (0.7 × 年齡)
//   儲備心率 (HRR) = 最大心率 - 安靜心跳
export function computeBaseline(age, restingHr) {
  const maxHr = Math.round(207 - 0.7 * age);
  const hrr = Math.max(1, maxHr - restingHr);
  return { age, restingHr, maxHr, hrr };
}

// 目前心率相當於儲備心率的百分比（Karvonen）
export function hrIntensity(hr, base) {
  return (hr - base.restingHr) / base.hrr;
}

// 由某個 %HRR 反推目標心率（顯示區間用）
export function targetHr(pct, base) {
  return Math.round(base.restingHr + pct * base.hrr);
}

// 各區間的 %HRR 範圍（流程圖上的「目標心率」）
export const ZONE_RANGE = {
  LOW: [0.3, 0.39],
  HIGH: [0.4, 0.59],
  MAX: [0.6, 0.89],
};

// 心率落在哪個區間
export function zoneFromHr(hr, base) {
  const p = hrIntensity(hr, base);
  if (p < ZONE_RANGE.HIGH[0]) return ZONES.LOW; // < 40% HRR
  if (p < ZONE_RANGE.MAX[0]) return ZONES.HIGH; // 40–59%
  return ZONES.MAX; // ≥ 60%
}

// ── 呼吸判定（RR = 每分鐘呼吸次數；dRR = 近 5 秒變化量）──
const breathSteady = (rr, dRR) => rr >= 15 && rr <= 25 && Math.abs(dRR) < 3;
const breathSurge = (dRR) => dRR >= 5; // 突增：ΔRR ≥ +5 次/5 秒
const breathHigh = (rr, highDur) => rr > 25 && highDur > 5; // 偏高且維持 > 5 秒

// 退檔速率限制：每 0.5 秒減少 5% 動力
export const RAMP_STEP = 5; // %
export const RAMP_INTERVAL_MS = 500;

// 主決策：依「區間 + 呼吸」決定狀態與馬達指令
//   motorMode: 'hold' 直接到 target | 'spike' 瞬間爆發 | 'rampDown' 平滑退檔 | 'min80' 維持 ≥80%
export function decide({ zone, rr, dRR, rrHighDur }) {
  // 狀態 C：HR_MAX → 安全防護（不看呼吸，強制維持高輔助）
  if (zone.id === "MAX") {
    return {
      state: "安全防護",
      note: "騎士負載極大，維持高輔助或強制介入",
      motor: MOTOR.LV_HIGH,
      motorMode: "min80",
    };
  }

  // 狀態 B：HR_HIGH
  if (zone.id === "HIGH") {
    if (breathSurge(dRR)) {
      return {
        state: "短暫爆發",
        note: "呼吸突增，馬達瞬間 80%",
        motor: MOTOR.LV_BOOST,
        motorMode: "spike",
      };
    }
    if (breathHigh(rr, rrHighDur)) {
      return {
        state: "高負載",
        note: "呼吸偏高且持續，馬達持續 80%",
        motor: MOTOR.LV_HIGH,
        motorMode: "hold",
      };
    }
    if (breathSteady(rr, dRR)) {
      return {
        state: "恢復期",
        note: "呼吸回穩，平滑退檔 80% → 50%",
        motor: MOTOR.LV_MED,
        motorMode: "rampDown",
      };
    }
    // 區間內未觸發特定條件 → 維持高負載
    return {
      state: "高負載",
      note: "維持輔助",
      motor: MOTOR.LV_HIGH,
      motorMode: "hold",
    };
  }

  // 狀態 A：HR_LOW → 基礎騎行
  return {
    state: "基礎騎行",
    note: breathSteady(rr, dRR) ? "呼吸平穩，基礎輔助" : "低強度巡航",
    motor: MOTOR.LV_LOW,
    motorMode: "hold",
  };
}

// 依指令更新目前馬達輸出（每 0.5 秒呼叫一次）
export function nextMotorPct(prev, dir) {
  switch (dir.motorMode) {
    case "spike":
      return 80; // 瞬間爆發
    case "rampDown":
      return Math.max(MOTOR.LV_MED.pct, prev - RAMP_STEP); // -5%/0.5s 至 50%
    case "min80":
      return Math.max(80, prev); // 維持 ≥ 80%
    case "hold":
    default: {
      const target = dir.motor.pct;
      if (prev < target) return Math.min(target, prev + 10);
      if (prev > target) return Math.max(target, prev - 10);
      return target;
    }
  }
}
