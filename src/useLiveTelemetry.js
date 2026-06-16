import { useEffect, useState } from "react";

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 模擬「感測器一直吐數據」：每秒更新一次（之後可換成真實 CSV / serial 資料）
export function useLiveTelemetry() {
  const [t, setT] = useState({
    battery: 86, // %
    speed: 0, // km/h
    cadence: 0, // rpm
    assist: 2, // 0~5
    motorTemp: 32, // °C
    voltage: 47.8, // V
  });

  useEffect(() => {
    const id = setInterval(() => {
      setT((p) => {
        const speed = clamp(p.speed + rand(-3, 3.2), 0, 25);
        const cadence =
          speed < 1
            ? clamp(p.cadence + rand(-15, 3), 0, 80)
            : clamp(p.cadence + rand(-6, 6), 50, 78);
        // 輔助段位偶爾才換
        const assist =
          Math.random() < 0.1
            ? clamp(p.assist + (Math.random() < 0.5 ? -1 : 1), 0, 5)
            : p.assist;
        const battery = clamp(p.battery - Math.random() * 0.05, 0, 100);
        const motorTemp = clamp(p.motorTemp + rand(-1, 1.2), 25, 78);
        const voltage = +(46 + (battery / 100) * 4).toFixed(1);
        return {
          battery: +battery.toFixed(1),
          speed: Math.round(speed),
          cadence: Math.round(cadence),
          assist,
          motorTemp: Math.round(motorTemp),
          voltage,
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return t;
}
