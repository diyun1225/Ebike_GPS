// ============================================================
//  地圖同步 · 後台觀看設定檔範本
//  複製這個檔成 config.js，填入實際數值即可（config.js 不進版控）。
//  三個值要和「騎士 App」那邊一模一樣才收得到。
// ============================================================
window.MAP_SYNC = {
  // Google Maps JavaScript API 金鑰
  googleKey: "YOUR_GOOGLE_MAPS_API_KEY",

  // MQTT broker（WebSocket 網址，要和 App 端一致）
  broker: "wss://broker.emqx.io:8084/mqtt",

  // 房間名稱（要和 App 端一致）
  room: "ebike-t860",
};
