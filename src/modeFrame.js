// 系統模式切換協議：把「目前所在模式」打包成 MODEREQ CAN 封包送給 AI 板。
//
// ── CAN 協議（依 AI 板正式指令表）─────────────────────────────
//   ID  = 0x1FA13000（命令 IoT→AI，延伸 29-bit）
//   DLC = 1
//   DATA = [modeCode]   modeCode = 1~3
//
//   modeCode  模式
//     1       一般模式
//     2       電量管理模式
//     3       智慧輔助模式
//
//   （心肺模式不算獨立切換模式 → 送一般模式(1)；智慧避震/變速改常開，不切換）
//
// 回傳 { id, dlc, data, tx }，tx 是送給板子的字串格式：CAN,<id>,<dlc>,<byte0>
//   例：一般模式(1) → "CAN,1FA13000,1,01"
//   實際送出：sendCommand(frame.tx)（見 useBleTelemetry.js / ccpaBle.js）
export const MODEREQ_ID = 0x1fa13000;

// 模式碼常數（1~3，給程式碼用，避免散落魔術數字）
export const MODE_CODE = {
  NORMAL: 1, // 一般模式
  BATTERY: 2, // 電量管理模式
  ASSIST: 3, // 智慧輔助模式
};

// App.jsx / HomeScreen 用的字串 id → modeCode 對照
// （這幾個字串是路由代號，見 HomeScreen.jsx 的 MODES 與 App.jsx 的切換）
//
// 目前「可切換」的模式只有 3 個：一般(1)、電量管理(2)、智慧輔助(3)。
//   - 心肺模式：不算獨立切換模式，進入時送「一般模式」的 MODEREQ（code 1）。
//   - 智慧避震 / 智慧變速：改成常開狀態，首頁選項已註解，不再送模式切換。
export const MODE_CODE_BY_ID = {
  normal: MODE_CODE.NORMAL,
  navigation: MODE_CODE.BATTERY,
  assist: MODE_CODE.ASSIST,
  heartrate: MODE_CODE.NORMAL, // 心肺 → 送一般模式 code(1)
};

const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

// 把模式碼(1~3)打包成 MODEREQ CAN 封包。code 不在 1~3 會回傳 null（不送）。
export function modeToFrame(code) {
  if (!Number.isInteger(code) || code < 1 || code > 3) return null;
  const data = [code & 0xff];
  return {
    id: MODEREQ_ID,
    dlc: 1,
    data,
    tx: `CAN,${MODEREQ_ID.toString(16).toUpperCase()},1,${hex2(data[0])}`,
  };
}

// 由 App 層字串 id 直接產生封包（找不到對應回傳 null）
export function modeIdToFrame(modeId) {
  const code = MODE_CODE_BY_ID[modeId];
  return code === undefined ? null : modeToFrame(code);
}

// App 層字串 id → 中文模式名稱（給確認視窗顯示用）
export const MODE_LABEL_BY_ID = {
  normal: "一般模式",
  navigation: "電量管理模式",
  assist: "智慧輔助模式",
  shift: "智慧變速模式",
  suspension: "智慧避震模式",
  heartrate: "心肺模式",
};

// ── MODE_ACK：AI 板對「這次 SET_MODE」的回覆（AI→IoT）──────────────
//   ID  = 0x1FA13001（＝ SET_MODE 的 ID + 1，延伸 29-bit）、DLC = 2
//   DATA = 0xA5 + 模式碼   例：A5 01 / A5 02 / A5 03
//   DATA[0] = 固定 0xA5（收到並執行）
//   DATA[1] = 回音：本次請求的模式碼（用來比對是哪一次切換）
//
// 註：舊規格表寫的是 ID 0x1FA23000、byte0 0xAA，與韌體實作不符——
//     實際是這裡的 0x1FA13001 / 0xA5。對錯 ID 會導致 ACK 永遠收不到、
//     每次切模式都逾時（模式其實有切成功）。詳見同目錄 modeFrame.md。
export const MODEACK_ID = 0x1fa13001;

const ACK_OK = 0xa5;

// 判斷一個已拆好的 frame（{id,dlc,data}）是不是 MODE_ACK。
//   是   → 回 { ok, echo }
//          ok   : true=收到並執行(0xA5) / false=其他值
//          echo : 本次請求的模式碼回音；沒帶這個 byte（DLC=1）時為 -1
//   不是 → 回 null
export function parseModeAck(frame) {
  if (!frame || frame.id !== MODEACK_ID) return null;
  const d = frame.data || [];
  return {
    ok: d[0] === ACK_OK,
    echo: d.length > 1 ? d[1] : -1,
  };
}

// ── MODE_STATE：AI 板每秒廣播「目前生效模式」（AI→IoT）────────────
//   ID  = 0x1FA23001（延伸 29-bit）、DLC = 1
//   DATA[0] = 目前生效模式（1~3）
//
// ⚠ 韌體尚未實作，這是提案中的擴充（見 modeFrame.md）。
//   與 MODE_ACK 分開的用意：ACK 是「回應這次請求」，這個是「純狀態回報」，
//   可用來確認板子實際狀態、偵測 App 與板子模式不同步。
//   程式已先接好，韌體加上去就自動生效；沒有也不影響現有流程。
export const MODESTATE_ID = 0x1fa23001;

// 判斷 frame 是不是 MODE_STATE 廣播。
//   是   → 回 { mode }（1~3；超出範圍或沒帶 byte 為 -1）
//   不是 → 回 null
export function parseModeState(frame) {
  if (!frame || frame.id !== MODESTATE_ID) return null;
  const d = frame.data || [];
  const m = d.length > 0 ? d[0] : -1;
  return { mode: m >= 1 && m <= 3 ? m : -1 };
}
