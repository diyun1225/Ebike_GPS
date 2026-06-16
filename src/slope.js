// 依坡度回傳顏色
export function gradeColor(grade) {
  if (grade <= -3) return "#1565c0"; // 明顯下坡 深藍
  if (grade < 1) return "#43a047"; // 平緩 綠
  if (grade < 4) return "#9ccc65"; // 微上坡 淺綠
  if (grade < 7) return "#fdd835"; // 中等 黃
  if (grade < 10) return "#fb8c00"; // 陡 橘
  if (grade < 13) return "#e53935"; // 很陡 紅
  return "#8e24aa"; // 超陡 紫
}

// 把坡度歸到一個級距（與顏色對應），自動分段用
export function gradeCategory(grade) {
  if (grade <= -3) return 0;
  if (grade < 1) return 1;
  if (grade < 4) return 2;
  if (grade < 7) return 3;
  if (grade < 10) return 4;
  if (grade < 13) return 5;
  return 6;
}

export function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + " km" : m.toFixed(0) + " m";
}

// 累計距離陣列（公尺）
function cumulative(google, locs) {
  const sph = google.maps.geometry.spherical;
  const cum = [0];
  for (let i = 1; i < locs.length; i++) {
    cum[i] = cum[i - 1] + sph.computeDistanceBetween(locs[i - 1], locs[i]);
  }
  return cum;
}

// 由 index 範圍產生一段的統計資料
function makeSegment(elevs, cum, startIdx, endIdx, index) {
  const startElev = elevs[startIdx].elevation;
  const endElev = elevs[endIdx].elevation;
  const elevChange = endElev - startElev;
  const segDist = cum[endIdx] - cum[startIdx];
  const grade = segDist > 0 ? (elevChange / segDist) * 100 : 0;

  let gain = 0;
  let loss = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const d = elevs[i + 1].elevation - elevs[i].elevation;
    if (d > 0) gain += d;
    else loss += -d;
  }

  const locs = elevs.slice(startIdx, endIdx + 1).map((r) => r.location);
  return { index, startElev, endElev, elevChange, segDist, grade, gain, loss, locs };
}

// 手動：平均切成 nSegments 段
export function buildSegments(google, elevs, nSegments) {
  const N = elevs.length;
  const cum = cumulative(google, elevs.map((r) => r.location));
  const segments = [];
  for (let s = 0; s < nSegments; s++) {
    const startIdx = Math.round((s * (N - 1)) / nSegments);
    const endIdx = Math.round(((s + 1) * (N - 1)) / nSegments);
    segments.push(makeSegment(elevs, cum, startIdx, endIdx, s + 1));
  }
  return { segments, totalDist: cum[N - 1] };
}

// 自動：依坡度變化分段
// window: 計算平滑坡度的視窗(公尺)；minSegment: 每段最短長度(公尺)
export function buildAutoSegments(google, elevs, opts = {}) {
  const N = elevs.length;
  const locs = elevs.map((r) => r.location);
  const elev = elevs.map((r) => r.elevation);
  const cum = cumulative(google, locs);
  const total = cum[N - 1];

  const WINDOW = opts.window ?? 120;
  const MIN_SEG = opts.minSegment ?? Math.max(150, total / 30);

  // 1. 每點用前後視窗算平滑坡度，再歸類到級距
  const cat = new Array(N);
  for (let i = 0; i < N; i++) {
    let a = i;
    let b = i;
    while (a > 0 && cum[i] - cum[a] < WINDOW / 2) a--;
    while (b < N - 1 && cum[b] - cum[i] < WINDOW / 2) b++;
    const d = cum[b] - cum[a];
    const g = d > 0 ? ((elev[b] - elev[a]) / d) * 100 : 0;
    cat[i] = gradeCategory(g);
  }

  // 2. 連續同級距 → 合併成一段（記錄 index 範圍）
  const ranges = [];
  let start = 0;
  for (let i = 1; i < N; i++) {
    if (cat[i] !== cat[i - 1]) {
      ranges.push([start, i]);
      start = i;
    }
  }
  ranges.push([start, N - 1]);

  // 3. 太短的段併進鄰居，避免破碎
  const len = (r) => cum[r[1]] - cum[r[0]];
  let changed = true;
  while (changed && ranges.length > 1) {
    changed = false;
    for (let k = 0; k < ranges.length; k++) {
      if (len(ranges[k]) < MIN_SEG) {
        if (k === 0) {
          ranges[1][0] = ranges[0][0];
          ranges.splice(0, 1);
        } else {
          ranges[k - 1][1] = ranges[k][1];
          ranges.splice(k, 1);
        }
        changed = true;
        break;
      }
    }
  }

  const segments = ranges.map((r, i) => makeSegment(elevs, cum, r[0], r[1], i + 1));
  return { segments, totalDist: total };
}
