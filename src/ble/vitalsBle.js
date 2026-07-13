/*
 * vitalsBle.js — 連線「樹莓派」（生理量測板），只收不送。
 *
 * 樹莓派走與單車相同的 BLE 服務 / TX 特徵（UUID 相同），但送的是純 JSON 一行，例：
 *   {"hr":72,"rr":16,"fi":0.83}
 * 欄位：hr=心率、rr=呼吸率、fi=疲勞值。大小寫都接受；這包沒帶到的欄位保留上一次的值。
 *
 * 對照 BLE/ble_phone.html 的 connectAi / onNotifyAi（架構B：第二台 BLE），邏輯相同。
 *
 *   import { connectVitals } from "./vitalsBle.js";
 *   const conn = await connectVitals({ onVitals: (v) => {...}, onStatus, onLog });
 *   conn.disconnect();
 */

const SERVICE = "0000cc01-c3d5-40b4-ab51-611746a316f3";
const TX = "0000cc03-c3d5-40b4-ab51-611746a316f3"; // 板 → host（notify）

// fi 是 0~1 的疲勞值（例 0.83），轉成 0~100 的百分比顯示。
export function fiToPct(fi) {
  if (fi == null || !Number.isFinite(fi)) return null;
  return Math.round(Math.max(0, Math.min(1, fi)) * 100);
}

// 從 JSON 物件挑 hr/rr/fi（大小寫都接受），只回傳這包真的有帶到的欄位
function pickVitals(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const lk = k.toLowerCase();
    if (lk === "hr" || lk === "rr" || lk === "fi") {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) out[lk] = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

export async function connectVitals(opts = {}) {
  const onVitals = opts.onVitals || function () {};
  const onStatus = opts.onStatus || function () {};
  const onLog = opts.onLog || function () {};

  if (!navigator.bluetooth) {
    onLog("✗ [Pi] 此瀏覽器沒有 Web Bluetooth");
    throw new Error("此瀏覽器不支援 Web Bluetooth（iPhone 請用 Bluefy）");
  }

  onLog("①[Pi] 掃描中…請在彈窗挑樹莓派");
  onStatus("掃描中…");
  // 不確定樹莓派叫什麼名字，列出全部讓使用者自己挑（要帶 SERVICE 才能連上後存取同組 UUID）
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICE],
  });
  onLog("②[Pi] 已選裝置：" + (device.name || device.id));
  device.addEventListener("gattserverdisconnected", () => {
    onLog("✗ [Pi] 裝置斷線");
    onStatus("已斷線");
  });

  onStatus("連線中…");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE);
  const tx = await service.getCharacteristic(TX);
  await tx.startNotifications();

  const td = new TextDecoder();
  let buf = ""; // 獨立行緩衝，與單車的分開，碎片才不會互相污染
  tx.addEventListener("characteristicvaluechanged", (e) => {
    buf += td.decode(e.target.value);
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || line[0] !== "{") continue; // 只認 JSON 一行
      try {
        const v = pickVitals(JSON.parse(line));
        if (v) {
          onVitals(v);
          onLog("♥[Pi] " + line);
        }
      } catch {
        // 不是完整 JSON（被 BLE 切斷）→ 留著等下一段拼回來
      }
    }
  });

  onStatus("已連線");
  onLog("✅[Pi] 訂閱成功！等樹莓派送 JSON（hr/rr/fi）");
  return {
    device,
    disconnect() {
      if (device.gatt.connected) device.gatt.disconnect();
    },
  };
}
