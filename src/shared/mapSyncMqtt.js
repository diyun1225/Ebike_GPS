import mqtt from "mqtt";

// 地圖同步發送端（前台）
// 把導航算出來的「路線 polyline」與「即時位置」publish 到 MQTT，
// 讓 public/map-sync.html 的「後台（觀看）」訂閱同房間 → 用它自己的地圖還原。
// topic / 格式必須與 map-sync.html 完全一致：
//   ebike/<room>/route  { from, to, polyline, summary:{distText,durText} }
//   ebike/<room>/gps    { lat, lng, heading }

// 瀏覽器只能走 WebSocket；App 是 HTTPS(basicSsl) 時務必用 wss://。
// 你自架 broker(118.163.180.29) 要另外開 websockets listener（1883 是純 TCP，連不到）。
const URL = import.meta.env.VITE_MQTT_URL || "wss://broker.emqx.io:8084/mqtt";
const ROOM = import.meta.env.VITE_MQTT_ROOM || "ebike-demo";

const T = {
  route: `ebike/${ROOM}/route`,
  gps: `ebike/${ROOM}/gps`,
};

let client = null;

// 惰性連線：第一次要 publish 時才連，重複呼叫不重連
function ensureClient() {
  if (client) return client;
  client = mqtt.connect(URL, {
    clientId: "app-front-" + Math.random().toString(16).slice(2, 8),
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 8000,
    // 遺囑：App 意外關閉/斷網時，broker 自動幫我們發「結束」給後台
    will: {
      topic: T.route,
      payload: JSON.stringify({ end: true }),
      qos: 1,
      retain: true,
    },
  });
  client.on("connect", () => console.log("[mapSync] MQTT 已連線", URL, "房間", ROOM));
  client.on("error", (e) => console.warn("[mapSync] MQTT 錯誤:", e?.message || e));
  client.on("close", () => console.log("[mapSync] MQTT 連線關閉"));
  return client;
}

// 目前使用的房間，方便在畫面上提示使用者去 map-sync.html 填一樣的
export const mapSyncRoom = ROOM;

// 規劃好路線時發一次；retain 讓後台晚點連進來也立刻收到最後這條
export function publishRoute({ from, to, polyline, distText, durText }) {
  if (!polyline) return;
  const c = ensureClient();
  c.publish(
    T.route,
    JSON.stringify({ from, to, polyline, summary: { distText, durText } }),
    { qos: 1, retain: true }
  );
  console.log("[mapSync] → 已送路線 (polyline", polyline.length, "字元)");
}

// 導航中的即時位置（呼叫端自行節流成每秒一次）
export function publishGps(lat, lng, heading) {
  if (!client) return; // 還沒發過路線就不發位置
  client.publish(
    T.gps,
    JSON.stringify({ lat, lng, heading: heading || 0 }),
    { qos: 0 }
  );
}

// 離開導航：主動通知後台「導航結束」，清掉 retain 的路線，再優雅斷線
export function endMapSync() {
  if (!client) return;
  const c = client;
  client = null;
  // 覆蓋掉 retain 的路線 → 後台會清空地圖；晚點才連進來的後台也只會收到 end
  c.publish(T.route, JSON.stringify({ end: true }), { qos: 1, retain: true });
  console.log("[mapSync] → 已通知後台結束導航");
  // force=false：把上面這則送出去後才真正斷線
  c.end(false);
}
