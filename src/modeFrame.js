// 系統模式切換協議：把「目前所在模式」打包成 MODEREQ CAN 封包送給 AI 板。
//
// ── CAN 協議（需與 AI 板韌體對齊）─────────────────────────────
//   ID  = 0x2940011（延伸 29-bit，仿 ASSISTREQ 0x2940015）
//   DLC = 1
//   DATA = [modeCode]   modeCode 見下表（0~5）
//
//   modeCode  模式
//     0       一般模式
//     1       電量管理模式
//     2       智慧輔助模式
//     3       智慧變速模式
//     4       智慧避震模式
//     5       心肺模式
//
// 回傳 { id, dlc, data, tx }，tx 是送給板子的字串格式：CAN,<id>,<dlc>,<byte0>
//   例：心肺模式(5) → "CAN,2940011,1,05"
//   實際送出：sendCommand(frame.tx)（見 useBleTelemetry.js / ccpaBle.js）
export const MODEREQ_ID = 0x2940011;

// 模式碼常數（給程式碼用，避免散落魔術數字）
export const MODE_CODE = {
  NORMAL: 0, // 一般模式
  BATTERY: 1, // 電量管理模式
  ASSIST: 2, // 智慧輔助模式
  SHIFT: 3, // 智慧變速模式
  SUSPENSION: 4, // 智慧避震模式
  HEARTRATE: 5, // 心肺模式
};

// App.jsx / HomeScreen 用的字串 id → modeCode 對照
// （這幾個字串是路由代號，見 HomeScreen.jsx 的 MODES 與 App.jsx 的切換）
export const MODE_CODE_BY_ID = {
  normal: MODE_CODE.NORMAL,
  navigation: MODE_CODE.BATTERY,
  assist: MODE_CODE.ASSIST,
  shift: MODE_CODE.SHIFT,
  suspension: MODE_CODE.SUSPENSION,
  heartrate: MODE_CODE.HEARTRATE,
};

const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

// 把模式碼(0~5)打包成 MODEREQ CAN 封包。code 不在 0~5 會回傳 null（不送）。
export function modeToFrame(code) {
  if (!Number.isInteger(code) || code < 0 || code > 5) return null;
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

// ── MODEACK：AI 板收到 MODEREQ 後回傳的確認封包 ────────────────
//   ID  = 0x2940012（延伸 29-bit）
//   DLC = 2
//   DATA = [modeCode, status]
//     status = 1 → 收到並已切換（OK）
//     status = 0 → 拒絕 / 失敗
export const MODEACK_ID = 0x2940012;

// 判斷一個已拆好的 frame（{id,dlc,data}）是不是 MODEACK。
//   是   → 回 { code, ok }
//   不是 → 回 null
export function parseModeAck(frame) {
  if (!frame || frame.id !== MODEACK_ID) return null;
  const d = frame.data || [];
  return { code: d.length > 0 ? d[0] : -1, ok: d[1] === 1 };
}
