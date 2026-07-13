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

// fi 是疲勞值，實測資料範圍約 0~100（例 6.4、10.1），直接當百分比顯示（夾在 0~100）。
// 註：若韌體實際範圍不是 0~100，改這裡的縮放即可。
export function fiToPct(fi) {
  if (fi == null || !Number.isFinite(fi)) return null;
  return Math.round(Math.max(0, Math.min(100, fi)));
}

// 從 JSON 物件挑 hr/rr/fi（大小寫都接受），只回傳這包真的有帶到的欄位。
// 匯出給單車連線（ccpaBle）共用：毫米波 JSON 也可能跟 CAN 混在同一條 BLE TX 進來。
// 欄位名容錯：不同版本韌體用過不同名字（例 MQTT schema 是 heart_rate_bpm），
// 這裡都收，統一輸出成 { hr, rr, fi }。
const VITAL_ALIASES = {
  hr: ["hr", "heart_rate_bpm", "heartrate", "heart_rate", "hr_bpm"],
  rr: ["rr", "r_rate_bpm", "resp_rate", "respiration", "rr_brpm", "breath_rate"],
  fi: ["fi", "fatigue", "fatigue_pct", "fatigue_index"],
};
export function pickVitals(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const lk = k.toLowerCase();
    for (const std of Object.keys(VITAL_ALIASES)) {
      if (VITAL_ALIASES[std].includes(lk)) {
        const n = Number(obj[k]);
        if (Number.isFinite(n)) out[std] = n;
      }
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
  let rxCount = 0;
  tx.addEventListener("characteristicvaluechanged", (e) => {
    const chunk = td.decode(e.target.value);
    rxCount++;
    // 診斷用：每次收到的原始位元組都印出來（含空行/亂碼），才看得出 Pi 到底送了什麼
    onLog(`⑦[Pi] 收到 #${rxCount}（${e.target.value.byteLength} bytes）: ${JSON.stringify(chunk)}`);
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue; // 空行（心跳）忽略，不算失敗
      if (line[0] !== "{") {
        onLog("⚠[Pi] 丟棄：不是 JSON 開頭（非 { ）→ " + JSON.stringify(line));
        continue;
      }
      try {
        const obj = JSON.parse(line);
        const v = pickVitals(obj);
        if (v) {
          onVitals(v);
          onLog("♥[Pi] " + line);
        } else {
          onLog("⚠[Pi] JSON 沒有 hr/rr/fi 欄位 → " + line);
        }
      } catch {
        // 這行以 { 開頭又有換行結尾卻 parse 失敗 → JSON 壞掉（已丟棄，非片段）
        onLog("✗[Pi] JSON 解析失敗（格式壞掉，已丟棄）：" + JSON.stringify(line));
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
