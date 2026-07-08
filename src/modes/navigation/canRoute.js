// 把「電量管理模式」導航切出的路段/坡度資料，打包成 CAN 字串送給 AI 運算板。
// 沿用 heartrate/canFrame.js 的 tx 格式：CAN,<id 16進>,<dlc>,<byte0>,<byte1>,...
//   例：CAN,2940021,7,03,20,03,F4,01,20,03
// AI 板固件收到後再轉成實體 CAN 幀送上匯流排。
//
// 一趟導航送兩種訊息：
//   ROUTE_HDR (0x2940020) 路線表頭：導航開始時送一次（route_id + 路段總數 + 總距離）
//   ROUTE_SEG (0x2940021) 路段資料：每個路段一幀（先上傳整條剖面，行進中再回報目前段）
//
// 欄位對應（AI 板 schema）：
//   route_id           路線識別碼(string|null) → uint16（null→0；字串→16-bit 雜湊）放表頭
//   segment_index      路段序號(number|null)   → uint8（null→0xFF）
//   segment_distance_m 路段距離(m)             → uint16 LE（公尺，夾在 0..65535）
//   grade_pct          坡度(%)                 → int16 LE ×100（0.01% 解析，±327%）
//   elevation_delta_m  高度變化(m)             → int16 LE ×10（0.1m 解析，±3276m）

export const ROUTE_HDR_ID = 0x2940020;
export const ROUTE_SEG_ID = 0x2940021;

const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

// 位元組打包工具（小端 LE，與韌體約定一致）
const u8 = (v) => Math.max(0, Math.min(0xff, Math.round(v))) & 0xff;
const u16le = (v) => {
  const n = Math.max(0, Math.min(0xffff, Math.round(v)));
  return [n & 0xff, (n >> 8) & 0xff];
};
const i16le = (v) => {
  let n = Math.max(-32768, Math.min(32767, Math.round(v)));
  if (n < 0) n += 0x10000;
  return [n & 0xff, (n >> 8) & 0xff];
};

// route_id 可能是字串/數字/null → 壓成 uint16 當路線識別碼
// 字串用 FNV-1a（16-bit 版）雜湊，讓同一條路線名對到同一個 id
export function routeIdToU16(routeId) {
  if (routeId == null) return 0;
  if (typeof routeId === "number") return routeId & 0xffff;
  let h = 0x811c;
  const s = String(routeId);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x0101) & 0xffff; // FNV prime 低 16 位
  }
  return h & 0xffff;
}

function frame(id, data) {
  return {
    id,
    dlc: data.length,
    data,
    tx: `CAN,${id.toString(16).toUpperCase()},${data.length},${data
      .map(hex2)
      .join(",")}`,
  };
}

// 路線表頭：route_id(2) + 路段總數(1) + 總距離 m(2) = 5 bytes
export function routeHeaderFrame({
  routeId = null,
  segmentCount = 0,
  totalDistanceM = 0,
} = {}) {
  const data = [
    ...u16le(routeIdToU16(routeId)), // b0-1 route_id
    u8(segmentCount), //              b2   路段總數
    ...u16le(totalDistanceM), //      b3-4 總距離(m)
  ];
  return frame(ROUTE_HDR_ID, data);
}

// 單一路段：index(1) + 距離 m(2) + 坡度 ×100(2) + 高度變化 ×10(2) = 7 bytes
export function segmentFrame({
  segmentIndex = null,
  segmentDistanceM = 0,
  gradePct = 0,
  elevationDeltaM = 0,
} = {}) {
  const data = [
    segmentIndex == null ? 0xff : u8(segmentIndex), // b0   路段序號
    ...u16le(segmentDistanceM), //                     b1-2 路段距離(m)
    ...i16le(gradePct * 100), //                       b3-4 坡度 ×100
    ...i16le(elevationDeltaM * 10), //                 b5-6 高度變化 ×10
  ];
  return frame(ROUTE_SEG_ID, data);
}

// 由 slope.js 產出的 segment 物件轉成一幀路段 CAN
export function segmentToFrame(seg) {
  return segmentFrame({
    segmentIndex: seg.index,
    segmentDistanceM: seg.segDist,
    gradePct: seg.grade,
    elevationDeltaM: seg.elevChange,
  });
}

// 一趟導航要上傳的整包：表頭 + 每段一幀
export function routeProfileFrames(segments = [], routeId = null, totalDistanceM = 0) {
  return [
    routeHeaderFrame({ routeId, segmentCount: segments.length, totalDistanceM }),
    ...segments.map(segmentToFrame),
  ];
}
