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

const MAX_BUF = 4096; // 緩衝上限：超過還拼不出完整 JSON 就清空，避免無限膨脹

// 從緩衝抽出所有「大括號成對」的完整 JSON 字串，回傳 [完整物件陣列, 剩餘緩衝]。
// 不依賴換行：送出端有沒有加 \n 都能解；被 BLE 切斷的半包會留在剩餘緩衝等下一段拼回。
// 會正確跳過字串內的大括號（例："a{b"），並丟掉物件之間的雜訊（空白 / 換行）。
export function extractJsonObjects(buf) {
  const out = [];
  let depth = 0;
  let start = -1;
  let lastEnd = 0;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(buf.slice(start, i + 1));
          lastEnd = i + 1;
          start = -1;
        }
      }
    }
  }
  // 還沒收完的半包（start >= 0）留著；否則只留最後一個完整物件之後的內容
  const rest = start >= 0 ? buf.slice(start) : buf.slice(lastEnd);
  return [out, rest];
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
    // 用大括號配對抽出完整 JSON，不依賴換行結尾
    // （實測樹莓派送的是 35 bytes 的 {"hr":..,"rr":..,"fi":..}，後面「沒有」\n，
    //   舊版靠 indexOf("\n") 切行 → 永遠切不出來，資料全卡在 buffer。）
    const [objs, rest] = extractJsonObjects(buf);
    buf = rest;
    // 保險：buffer 一直長不完整（收到非 JSON 垃圾）就丟掉，避免無限膨脹
    if (buf.length > MAX_BUF) {
      onLog(`⚠[Pi] 緩衝超過 ${MAX_BUF} 字元仍拼不出 JSON，已清空`);
      buf = "";
    }
    for (const text of objs) {
      try {
        const v = pickVitals(JSON.parse(text));
        if (v) {
          onVitals(v);
          onLog("♥[Pi] " + text);
        } else {
          // 例如 {"status":"streaming"} 這種狀態訊息，正常，不是錯誤
          onLog("ℹ[Pi] 非生理資料（沒有 hr/rr/fi）→ " + text);
        }
      } catch {
        onLog("✗[Pi] JSON 解析失敗（已丟棄）：" + JSON.stringify(text));
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
