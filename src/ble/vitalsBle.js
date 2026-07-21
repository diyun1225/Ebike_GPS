/*
 * vitalsBle.js — 生理量測（毫米波 hr/rr/fi）的解析工具。
 *
 * 資料來源：ESP32 直接連毫米波，再透過「單車那條 BLE」把資料送給手機——
 *   ・hr/rr 走 CAN 0x1FA15000（見 modes/normal/ble/ccpaDecode.js 的 parseMmwaveVitals）
 *   ・或走同一條 TX 混進來的 JSON，例 {"hr":72,"rr":16,"fi":0.83}
 *
 * 註：手機原本另外連一條「樹莓派專線」（connectVitals），架構改成由 ESP32 轉發後
 *     已移除；這裡只留下兩種來源共用的解析工具。
 */

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

// 從緩衝抽出所有「大括號成對」的完整 JSON 字串，回傳 [完整物件陣列, 剩餘緩衝]。
// ⚠ 目前 ccpaBle 是用換行切行的（CAN 文字行都有 \n）。這個工具留著是因為
//    毫米波 JSON 實測「結尾沒有 \n」——之後 ESP32 若把 JSON 混進同一條 TX 轉發，
//    要改用這個解，否則會像先前樹莓派那樣整包卡在 buffer 裡永遠切不出來。
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
