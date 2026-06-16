// 依路線距離、總爬升、總重量，估算這趟會用掉多少電（%）
// 模型很簡化，僅供 demo：滾動阻力(隨距離) + 爬坡位能(隨重量與爬升)
export function estimateUsedPct({ distanceM = 0, gainM = 0, weightKg = 100 }) {
  const capacityWh = 500; // 假設電池 500Wh
  const distKm = distanceM / 1000;

  // 平路每公里耗電，重量越重越耗
  const baseWhPerKm = 8;
  const weightExtraPerKm = Math.max(0, weightKg - 95) * 0.05;
  const rollingWh = distKm * (baseWhPerKm + weightExtraPerKm);

  // 爬坡位能：E = m*g*h (焦耳)，換算成 Wh，再除以馬達效率
  const efficiency = 0.55;
  const climbWh = (weightKg * 9.8 * gainM) / 3600 / efficiency;

  const usedWh = rollingWh + climbWh;
  return (usedWh / capacityWh) * 100;
}

// 由現在時間 + 路線秒數，算抵達時刻 "HH:MM"
export function arrivalTime(durationSec) {
  if (!durationSec) return "—";
  const t = new Date(Date.now() + durationSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
