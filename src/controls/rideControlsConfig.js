// 騎乘手動控制（浮動小球）設定檔
// ───────────────────────────────────────────────────────────────
// 概念：每個模式都會「自動接管」某一項（例：電量管理自動控輔助力），
// 那一項就不放進手動控制；其餘讓使用者用小球手動調。
// 要改哪個模式能調什麼，只動下面這張表即可。
//
// 三種可控項目的代號：
//   "assist"     輔助力段位（0~5）
//   "shift"      變速檔位（相對升/降檔）
//   "suspension" 避震軟硬（0 最軟 ~ 5 最硬）

export const RIDE_CONTROLS_BY_MODE = {
  normal: ["assist", "shift", "suspension"], // 一般模式：三項全可改
  navigation: ["shift", "suspension"], // 電量管理：輔助力由模式自動控
  assist: ["shift", "suspension"], // 智慧輔助：輔助力由模式自動控
  suspension: ["assist", "shift"], // 智慧避震：避震由模式自動控
  shift: ["assist", "suspension"], // 智慧變速：變速由模式自動控
  heartrate: ["shift", "suspension"], // 心肺：輔助力由心率引擎自動控
};

// 每個模式「自動接管」的那一項（顯示在卡片底部，讓使用者知道為何少一項）
export const AUTO_CONTROLLED_BY_MODE = {
  normal: null,
  navigation: "assist",
  assist: "assist",
  suspension: "suspension",
  shift: "shift",
  heartrate: "assist",
};

// 項目中文名（說明文字用）
export const CONTROL_LABEL = {
  assist: "輔助力",
  shift: "變速",
  suspension: "避震",
};

// 輔助力：韌體 control_set_assist_level 收 0~5；0=無輔助、5=最強
export const ASSIST_MIN = 0;
export const ASSIST_MAX = 5;

// 避震：0 最軟 ~ 5 最硬（共 6 段）
export const SUSPENSION_MIN = 0;
export const SUSPENSION_MAX = 5;

// 變速：實體雖有 10 檔，但只開放 1~9 檔可操作（第 10 檔不開放）。
export const SHIFT_MIN = 1;
export const SHIFT_MAX = 9;
// 遙測 Derailleur State(0x650) 的 GearRange 有回報就以車子為準，但仍不超過
// SHIFT_MAX；拿不到遙測時用這個當備援上限（相對升/降檔本來不需知道總數）。
export const SHIFT_FALLBACK_MAX = 9;
