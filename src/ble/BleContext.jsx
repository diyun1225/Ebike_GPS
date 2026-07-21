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

const BleContext = createContext(null);

export function BleProvider({ children }) {
  // 只剩「一條」BLE 連線：自行車 / ESP32（車況 + 控制 + 生理量測）。
  //
  // 生理量測（hr/rr/fi）來源：原本手機要另外連一條樹莓派專線，現在改由
  // ESP32 直接連毫米波，再透過這條 BLE 轉發給手機——
  //   ・hr/rr 走 CAN 0x1FA15000（見 ccpaDecode 的 parseMmwaveVitals）
  //   ・或走同一條 TX 混進來的 JSON（pickVitals）
  // 兩種都併進 bike.vitals，所以模式一律讀 ble.vitals 即可。
  //
  // 註：ESP32 另外會把同一份資料發到 MQTT ouo/v1/vehicle/state（source:"can"），
  //     那是給後台 / 其他消費端用的，App 不從那邊讀。
  const bike = useBleTelemetry();
  return <BleContext.Provider value={bike}>{children}</BleContext.Provider>;
}

export function useBle() {
  const ctx = useContext(BleContext);
  if (!ctx) throw new Error("useBle 必須在 <BleProvider> 內使用");
  return ctx;
}
