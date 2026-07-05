// 心肺模式決策邏輯（對應流程圖）
// 全部是純函式，方便之後單獨測試 / 替換成真實感測器資料

// 輔助力段數：1(最低) ~ 5(最高)，6 = 無輔助
export const GEAR_NONE = 6;
// 段數 → 實際出力大小（無=0 最小），給漸進/退檔排序用
const power = (gear) => (gear === GEAR_NONE ? 0 : gear); // 0~5
const gearFromPower = (p) => (p <= 0 ? GEAR_NONE : Math.min(5, p));

// 三個心率區間（車錶燈色）
export const ZONES = {
  LOW: { id: "LOW", abc: "A", label: "HR_LOW", name: "低強度", light: "藍燈", color: "#2f7bff" },
  HIGH: { id: "HIGH", abc: "B", label: "HR_HIGH", name: "中強度", light: "綠燈", color: "#1db954" },
  MAX: { id: "MAX", abc: "C", label: "HR_MAX", name: "高強度", light: "橘燈", color: "#ff8a1f" },
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

export const RAMP_INTERVAL_MS = 500;

// 主決策：依「區間 + 呼吸」決定狀態與目標輔助力段數
//   targetGear: 目標段數（1~5，6=無）
//   mode: 'hold' 平滑趨近 | 'spike' 瞬間拉滿 | 'rampDown' 一次退一段 | 'min' 維持 ≥ 目標
export function decide({ zone, rr, dRR, rrHighDur }) {
  // 狀態 C：HR_MAX → 安全防護（不看呼吸，強制維持最高段）
  if (zone.id === "MAX") {
    return {
      state: "安全防護",
      note: "騎士負載極大，維持最高段(5)或強制介入",
      targetGear: 5,
      mode: "min",
    };
  }

  // 狀態 B：HR_HIGH
  if (zone.id === "HIGH") {
    if (breathSurge(dRR)) {
      return {
        state: "短暫爆發",
        note: "呼吸突增，瞬間拉到最高段(5)",
        targetGear: 5,
        mode: "spike",
      };
    }
    if (breathHigh(rr, rrHighDur)) {
      return {
        state: "高負載",
        note: "呼吸偏高且持續，維持第 4 段",
        targetGear: 4,
        mode: "hold",
      };
    }
    if (breathSteady(rr, dRR)) {
      return {
        state: "恢復期",
        note: "呼吸回穩，平滑退檔至第 2 段",
        targetGear: 2,
        mode: "rampDown",
      };
    }
    // 區間內未觸發特定條件 → 維持中段
    return {
      state: "高負載",
      note: "維持第 3 段輔助",
      targetGear: 3,
      mode: "hold",
    };
  }

  // 狀態 A：HR_LOW → 基礎騎行
  if (breathSteady(rr, dRR)) {
    return {
      state: "基礎騎行",
      note: "呼吸平穩，輕鬆巡航不輔助",
      targetGear: GEAR_NONE,
      mode: "hold",
    };
  }
  return {
    state: "基礎騎行",
    note: "低強度巡航，第 1 段輔助",
    targetGear: 1,
    mode: "hold",
  };
}

// 依指令更新目前輔助力段數（每 0.5 秒呼叫一次），在「出力大小」空間漸進
export function nextGear(prevGear, dir) {
  const cur = power(prevGear);
  const tgt = power(dir.targetGear);
  let next;
  switch (dir.mode) {
    case "spike":
      next = tgt; // 瞬間拉到目標
      break;
    case "min":
      next = Math.max(cur, tgt); // 維持 ≥ 目標
      break;
    case "rampDown":
      next = Math.max(tgt, cur - 1); // 一次退一段
      break;
    case "hold":
    default:
      next = cur < tgt ? cur + 1 : cur > tgt ? cur - 1 : tgt; // 平滑趨近，一次一段
  }
  return gearFromPower(next);
}
