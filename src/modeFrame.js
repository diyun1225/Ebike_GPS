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

// ── MODEACK：AI 板的回覆 + 每秒廣播（AI→IoT）────────────────────
//   ID  = 0x1FA23000（延伸 29-bit）
//   DATA[0] = 狀態：0xAA 成功 / 0xEE 失敗
//   DATA[1] = 回音（板子收到的模式碼）
//   DATA[2] = 實際生效模式
// 註：這個 ID 每秒都會廣播，所以收到它不一定是「剛切換的回覆」，
//     App 層用 code(回音) 去比對是不是自己等的那次切換。
export const MODEACK_ID = 0x1fa23000;

const ACK_OK = 0xaa;
const ACK_FAIL = 0xee;

// 判斷一個已拆好的 frame（{id,dlc,data}）是不是 MODEACK / 模式廣播。
//   是   → 回 { ok, code, effectiveMode }
//          ok            : true=成功(0xAA) / false=失敗(0xEE 或其他)
//          code          : 回音（板子收到的模式碼，用來比對是哪次切換）
//          effectiveMode : 實際生效模式
//   不是 → 回 null
export function parseModeAck(frame) {
  if (!frame || frame.id !== MODEACK_ID) return null;
  const d = frame.data || [];
  return {
    ok: d[0] === ACK_OK,
    code: d.length > 1 ? d[1] : -1,
    effectiveMode: d.length > 2 ? d[2] : -1,
  };
}
