// canRoute.js — 電量管理模式：路段坡度 CAN 協定（編碼 + 定時傳送，對應 canRoute.md）
//
// 導航把路線依坡度切成路段後，透過 BLE 送 `CAN,<id 16進>,<dlc>,<byte0>,...`（newline 結尾）
// 給 AI 板，由 AI 板轉成實體 CAN 幀。所有多位元組欄位皆為 **小端 (LE)**。
//
// 一趟導航送兩種訊息：
//   ROUTE_HDR (0x1FA14000) 路線表頭：進入導航時送一次（route_id + 路段總數 + 總距離）
//   ROUTE_SEG (0x1FA14001) 路段資料：先上傳整條剖面，行進中再回報目前段（並每秒重送以利同步）
//
// 兩種用法：
//   1) 純編碼：routeProfileFrames() / segmentToFrame() 直接拿 frame（含 .tx 字串）自行送。
//   2) 有狀態傳送：new RouteCan(sendCmd) → start()/setSegment()/stop()，會自動每秒重送目前段。

export const ROUTE_HDR_ID = 0x1fa14000;
export const ROUTE_SEG_ID = 0x1fa14001;
export const RESEND_MS = 1000; // 目前段重送間隔(ms)；設 0 = 只在換段時送、不定時重送

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

// 由 slope.js 產出的 segment 物件（{index, segDist, grade, elevChange}）轉成一幀路段 CAN
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

// 把一段整理成「模型 schema」欄位（欄名同 canRoute.md，給 console.table 看的）
export function segRow(seg, routeId = null) {
  return {
    route_id: `0x${routeIdToU16(routeId).toString(16).toUpperCase()}`,
    segment_index: seg.index,
    segment_distance_m: Math.round(seg.segDist),
    grade_pct: +seg.grade.toFixed(2),
    elevation_delta_m: +seg.elevChange.toFixed(1),
    tx: segmentToFrame(seg).tx,
  };
}

// 有狀態傳送器：start() 送表頭+全段，之後「目前段」每秒自動重送（讓運算板中途連上也能同步）。
//   const rc = new RouteCan(sendCan);                         // sendCan(frame)：把 frame.tx 寫到 BLE
//   rc.start({ routeId, segments, totalDistanceM });          // 進入導航
//   rc.setSegment(idx);                                       // 行進中換段
//   rc.stop();                                                // 離開導航（務必呼叫，清掉計時器）
export class RouteCan {
  constructor(send) {
    this.send = send;
    this.segments = [];
    this.cur = -1;
    this.timer = null;
  }

  start({ routeId = null, segments = [], totalDistanceM = 0 } = {}) {
    this.stop();
    this.segments = segments;
    this.routeId = routeId;
    // 表頭 + 全段先上傳一次
    const frames = routeProfileFrames(segments, routeId, totalDistanceM);
    frames.forEach((f) => this.send(f));
    // ── 測試用：把整條路線整理好印到 console（不論有沒有連 BLE 都會印）──
    console.groupCollapsed(
      `📍 路線上傳 route_id=${routeId ?? "(null)"} → 0x${routeIdToU16(routeId)
        .toString(16)
        .toUpperCase()}｜${segments.length} 段｜總距 ${Math.round(totalDistanceM)} m`
    );
    console.log("表頭 tx:", frames[0].tx);
    console.table(segments.map((s) => segRow(s, routeId)));
    console.groupEnd();
    if (segments.length) this.setSegment(0);
  }

  setSegment(i) {
    if (i < 0 || i >= this.segments.length) return;
    this.cur = i;
    const s = this.segments[i];
    console.log(
      `➡️ 目前段 #${s.index}：${Math.round(s.segDist)}m, ${s.grade.toFixed(
        2
      )}%, Δ${s.elevChange.toFixed(1)}m ｜ ${segmentToFrame(s).tx}`
    );
    this._sendCur();
    clearInterval(this.timer);
    this.timer = null;
    if (RESEND_MS > 0) this.timer = setInterval(() => this._sendCur(), RESEND_MS);
  }

  _sendCur() {
    if (this.cur >= 0) this.send(segmentToFrame(this.segments[this.cur]));
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.cur = -1;
  }
}
