// 把 BLE 連線提升到 App 層：整個 App 共用「一條」與運算板的連線。
// （Web Bluetooth 限制：一個板子一次只能一個連線，所以連線狀態必須放最上層共享。）
//
//   <BleProvider>        ← 包在 App 最外層
//     ...
//   </BleProvider>
//
//   const ble = useBle(); // 任何模式 / App 都用這個拿共用連線
//
// 連線本身沿用 useBleTelemetry（原本住在一般模式，邏輯完全不變，只是提到共享層）。
import { createContext, useContext } from "react";
import { useBleTelemetry } from "../modes/normal/useBleTelemetry.js";
import { useVitalsBle } from "./useVitalsBle.js";

const BleContext = createContext(null);

export function BleProvider({ children }) {
  const bike = useBleTelemetry(); // 第一條連線：自行車（車況 + 控制）
  const pi = useVitalsBle(); //      第二條連線：樹莓派（hr/rr/fi 生理量測）
  // 相容既有用法：ble.* 仍是自行車；樹莓派掛在 ble.pi 底下（ble.pi.connect / ble.pi.vitals）
  return (
    <BleContext.Provider value={{ ...bike, pi }}>
      {children}
    </BleContext.Provider>
  );
}

export function useBle() {
  const ctx = useContext(BleContext);
  if (!ctx) throw new Error("useBle 必須在 <BleProvider> 內使用");
  return ctx;
}
