import { useCallback, useEffect, useRef, useState } from "react";
import { useGoogleMaps } from "./useGoogleMaps.js";
import { buildAutoSegments, gradeColor, fmtDist } from "./slope.js";
import { estimateUsedPct, arrivalTime } from "./battery.js";
import { routeProfileFrames, segmentToFrame } from "./canRoute.js";
import { useLiveTelemetry } from "../../shared/useLiveTelemetry.js";
import { publishRoute, publishGps, endMapSync } from "../../shared/mapSyncMqtt.js";
import { useBle } from "../../ble/BleContext.jsx";
import RouteForm from "./components/RouteForm.jsx";
import RouteSheet from "./components/RouteSheet.jsx";
import NavOverlay from "./components/NavOverlay.jsx";

const BIKE_KG = 25; // 車身重量（算總載重用）

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "YOUR_API_KEY";
// 有設定 Map ID（向量地圖）才能啟用 3D 傾斜導航；沒設定就用 2D 順暢跟隨
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => Math.random() * (b - a) + a;

// 沿路線各點的累計距離
function cumDistances(google, pts) {
  const sph = google.maps.geometry.spherical;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + sph.computeDistanceBetween(pts[i - 1], pts[i]);
  }
  return cum;
}

// 在距離 d 落在哪一段
function segIndexAt(cum, d) {
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  return i;
}

// 距離 d 處的座標（在兩點間內插）
function posAt(google, route, d) {
  const { points, cum } = route;
  const i = segIndexAt(cum, d);
  const segLen = cum[i + 1] - cum[i];
  const f = segLen > 0 ? (d - cum[i]) / segLen : 0;
  return google.maps.geometry.spherical.interpolate(
    points[i],
    points[i + 1],
    clamp(f, 0, 1)
  );
}

// 秒 → 「X 小時 Y 分」/「Y 分」
function fmtDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
}

// 去掉 Google 指示字串裡的 HTML 標籤
function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// 產生該趟導航的唯一路線編號：R-yyyyMMdd-HHmmss（每次規劃各不相同、可排序）
function makeRouteId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `R-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 把分段結果輸出成 txt（CSV，欄位與 AI 板 schema 一致；每列一段）
function segmentsToTxt(segs, routeId) {
  const rid =
    routeId == null ? "" : `"${String(routeId).replace(/"/g, '""')}"`; // 地址可能含逗號，故加引號
  const header =
    "route_id,segment_index,segment_distance_m,grade_pct,elevation_delta_m";
  const rows = segs.map((s) =>
    [
      rid,
      s.index ?? "",
      Math.round(s.segDist),
      s.grade.toFixed(2),
      s.elevChange.toFixed(1),
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

// 觸發瀏覽器下載一個純文字檔
function downloadTxt(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 距離 d 處的坡度(%)
function slopeAt(route, d) {
  const { cum, elevs } = route;
  const i = segIndexAt(cum, d);
  const run = cum[i + 1] - cum[i];
  if (run <= 0) return 0;
  return ((elevs[i + 1] - elevs[i]) / run) * 100;
}

export default function NavigationMode({ onBack }) {
  const { google, error: loadError } = useGoogleMaps(API_KEY);
  const live = useLiveTelemetry();
  const ble = useBle(); // 主畫面連好的共用連線，用來把坡度資料送 CAN 給 AI 板

  // 用 ref 拿最新的 ble，讓 sendCan 保持穩定（不必進各效果的相依陣列）。
  // 沒連線 / 沒控制特徵 / 模擬中沒真板時，都靜默略過（sendCommand 內部會安全 no-op）。
  const bleRef = useRef(ble);
  bleRef.current = ble;
  const sendCan = useCallback((frame) => {
    const b = bleRef.current;
    if (!b || b.phase !== "connected" || !b.canControl) return;
    b.sendCommand(typeof frame === "string" ? frame : frame.tx);
  }, []);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const dirServiceRef = useRef(null);
  const dirRendererRef = useRef(null);
  const elevServiceRef = useRef(null);
  const polylinesRef = useRef([]);
  const endMarkersRef = useRef([]); // 自己放的起/終點標記
  const infoWindowRef = useRef(null);
  const boundsRef = useRef(null);

  // 三階段：form 填表單(無地圖) → preview 看路線/坡度 → nav 車況導航
  const [phase, setPhase] = useState("form");

  // 表單輸入（提升到這層，preview 的路線列也要讀得到）
  const [stops, setStops] = useState(["", ""]);

  const [segments, setSegments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState({ msg: "", error: false });
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false); // 取得目前位置中
  const [riding, setRiding] = useState(false);

  const weightRef = useRef(70 + BIKE_KG); // 預設總載重（騎士 70 + 車身），電量估算基準
  const [sim, setSim] = useState(null); // 騎乘中的即時數據
  const [speedMult, setSpeedMult] = useState(1); // 加速播放倍率
  const [gps, setGps] = useState(false); // 真實 GPS 導航
  const gpsPrevRef = useRef(null); // 前一個 GPS 位置（算方向用）
  const compassRef = useRef(null); // 手機羅盤朝向（度，0=北、順時針；轉手機時箭頭跟著轉）

  const routeRef = useRef(null); // 模擬用的路線資料(points/elevs/cum/total)
  const simRef = useRef({ distM: 0 }); // 已騎距離
  const startBatteryRef = useRef(86);
  const riderMarkerRef = useRef(null);
  const riderCircleRef = useRef(null); // 定位點的白圈底
  const prevSegIdxRef = useRef(-1); // 目前高亮的坡度段

  // Google Maps 載入完成後初始化地圖
  useEffect(() => {
    if (!google || mapRef.current) return;
    mapRef.current = new google.maps.Map(mapDivRef.current, {
      center: { lat: 25.033, lng: 121.565 },
      zoom: 12,
      mapId: MAP_ID,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false, // 手機框內用不到，拿掉才不會擠到右上角的車況
    });
    dirServiceRef.current = new google.maps.DirectionsService();
    // 不掛到地圖：只用它拿路線資料，不讓它在圖上畫東西
    // （掛上去的話，自行車模式會被 Google 疊上「整區自行車道圖層」那一堆綠線）
    dirRendererRef.current = new google.maps.DirectionsRenderer({
      suppressPolylines: true, // 路線改用我們自己畫的彩色坡度線
      suppressMarkers: true, // 起/終點改用我們自己放
    });
    elevServiceRef.current = new google.maps.ElevationService();
    infoWindowRef.current = new google.maps.InfoWindow();
  }, [google]);

  // 切換階段時，叫地圖重繪、重新框住路線，並推一下強制補載破圖磚塊
  useEffect(() => {
    if (!mapRef.current || !google || phase === "form") return;
    const map = mapRef.current;
    const t1 = setTimeout(() => {
      google.maps.event.trigger(map, "resize");
      if (boundsRef.current) map.fitBounds(boundsRef.current);
    }, 80);
    // 稍後再推一下（panBy 來回 1px）強制重新載入沒補上的磚塊
    const t2 = setTimeout(() => {
      google.maps.event.trigger(map, "resize");
      map.panBy(1, 0);
      map.panBy(-1, 0);
    }, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase, google, summary]);

  // 進入導航：把整條路線剖面（表頭 + 各路段坡度）一次上傳給 AI 板
  useEffect(() => {
    if (phase !== "nav") return;
    const route = routeRef.current;
    if (!route?.segments?.length) return;
    prevSegIdxRef.current = -1; // 重置，讓行進中第一段也會回報
    const frames = routeProfileFrames(route.segments, route.routeId, route.total);
    frames.forEach((f) => sendCan(f));

    // 同步發送給網頁後台：一進導航就 publish 整條路線（retain，後台晚連也收得到）
    publishRoute({
      from: route.from,
      to: route.to,
      polyline: route.polyline,
      distText: route.distText,
      durText: route.durText,
      routeId: route.routeId,
      totalM: Math.round(route.total),
      maxGrade: +route.maxGrade.toFixed(1),
      segments: route.segProfile, // 整條路分段坡度 + 每段幾何
    });
  }, [phase, sendCan]);

  // 模擬騎乘：沿路線推進，速度/踏頻/輔助/電量隨坡度變化
  useEffect(() => {
    if (phase !== "nav" || !riding || !routeRef.current || !google) return;
    const route = routeRef.current;
    const map = mapRef.current;
    const sph = google.maps.geometry.spherical;

    const arrowIcon = (rotation) => ({
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 7.5,
      fillColor: "#1a73e8",
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 2,
      rotation,
    });

    if (!riderMarkerRef.current) {
      riderMarkerRef.current = new google.maps.Marker({
        map,
        position: posAt(google, route, simRef.current.distM),
        icon: arrowIcon(0),
        zIndex: 9999,
        optimized: false, // 平滑移動
      });
    }
    if (map.getZoom() < 15) map.setZoom(16);

    let rafId;
    let lastT = null;
    let lastHudT = 0;
    let lastPubT = 0; // 地圖同步：每秒發一次位置
    let lastHeading = 0;

    const frame = (now) => {
      if (lastT === null) lastT = now;
      const dtSec = Math.min(0.05, (now - lastT) / 1000) * speedMult; // 限制單幀跳動
      lastT = now;

      const s = simRef.current;
      const grade = slopeAt(route, s.distM);

      // 坡度影響速度：上坡慢、下坡快（移動用平滑值，不加雜訊）
      const speed = clamp(22 - grade * 1.2, 6, 25); // km/h（上限 25）
      s.distM += ((speed * 1000) / 3600) * dtSec;

      let finished = false;
      if (s.distM >= route.total) {
        s.distM = route.total;
        finished = true;
      }

      // 每幀移動騎士；用前方 20m 算行進方向（較穩定不抖）
      const pos = posAt(google, route, s.distM);
      const ahead = posAt(google, route, Math.min(route.total, s.distM + 20));
      const heading = sph.computeHeading(pos, ahead);
      riderMarkerRef.current.setPosition(pos);
      // 北方朝上：地圖不轉，箭頭指向行進方向（跟 Google Maps 截圖一樣）
      if (Math.abs(heading - lastHeading) > 2) {
        riderMarkerRef.current.setIcon(arrowIcon(heading));
        lastHeading = heading;
      }
      // 向量地圖用 moveCamera 平滑跟隨（平面 tilt 0、北方朝上）；無 Map ID 則 setCenter
      if (MAP_ID) {
        map.moveCamera({ center: pos, zoom: 17, tilt: 0, heading: 0 });
      } else {
        map.setCenter(pos);
      }

      // 地圖同步：每秒把目前位置發給網頁後台
      if (now - lastPubT > 1000 || finished) {
        lastPubT = now;
        publishGps(pos.lat(), pos.lng(), heading);
      }

      // 高亮目前所在的坡度段（只在換段時更新）
      const segEnds = route.segEnds || [];
      let segIdx = segEnds.findIndex((e) => s.distM <= e);
      if (segIdx === -1) segIdx = segEnds.length - 1;
      if (segIdx !== prevSegIdxRef.current) {
        polylinesRef.current.forEach((p, i) =>
          p.setOptions({
            strokeWeight: i === segIdx ? 11 : 6,
            strokeOpacity: i === segIdx ? 1 : 0.5,
            zIndex: i === segIdx ? 10 : 1,
          })
        );
        prevSegIdxRef.current = segIdx;
        // 換段就回報目前所在路段的坡度給 AI 板
        const seg = route.segments?.[segIdx];
        if (seg) sendCan(segmentToFrame(seg));
      }

      // 數據面板節流更新（每 250ms 一次，避免每幀重繪卡頓）
      if (now - lastHudT > 250 || finished) {
        lastHudT = now;
        const usedFrac = route.total > 0 ? s.distM / route.total : 0;
        const battery = Math.max(
          0,
          startBatteryRef.current - route.estUsedPct * usedFrac
        );
        const assist = grade > 6 ? 4 : grade > 3 ? 3 : grade > 0 ? 2 : 1;
        const cadence = finished
          ? 0
          : Math.round(clamp(66 - grade * 0.6 + rand(-4, 4), 48, 80));

        // 下一個轉彎指示
        let instruction = "";
        let maneuver = "straight";
        let turnM = 0;
        if (route.steps && route.steps.length) {
          const legDistDone = route.legDist
            ? (s.distM / route.total) * route.legDist
            : s.distM;
          let si = route.stepEnds.findIndex((e) => legDistDone < e);
          if (si === -1) si = route.steps.length - 1;
          const nextStep = route.steps[si + 1];
          instruction = finished
            ? "已抵達目的地"
            : nextStep
            ? nextStep.instruction
            : "繼續直行至終點";
          maneuver = finished ? "arrive" : nextStep ? nextStep.maneuver : "straight";
          turnM = Math.max(0, route.stepEnds[si] - legDistDone);
        }

        setSim({
          speed: finished ? 0 : Math.round(clamp(speed + rand(-1.5, 1.5), 0, 25)),
          cadence,
          assist,
          battery: +battery.toFixed(1),
          motorTemp: Math.round(34 + Math.max(0, grade)),
          voltage: +(46 + (battery / 100) * 4).toFixed(1),
          remainM: route.total - s.distM,
          finished,
          instruction,
          maneuver,
          turnM,
          grade: +grade.toFixed(1),
        });
      }

      if (finished) {
        setRiding(false);
        return;
      }
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [phase, riding, google, speedMult]);

  // 真實 GPS 導航：用手機定位移動，並把位置對應到規劃路線算坡度/剩餘/轉彎
  useEffect(() => {
    if (phase !== "nav" || !gps || !routeRef.current || !google) return;
    if (!navigator.geolocation) {
      alert("這個瀏覽器不支援定位");
      setGps(false);
      return;
    }
    const route = routeRef.current;
    const map = mapRef.current;
    const sph = google.maps.geometry.spherical;

    const arrowIcon = (rotation) => ({
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 7.5,
      fillColor: "#1a73e8",
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 2,
      rotation,
    });
    if (!riderMarkerRef.current) {
      riderMarkerRef.current = new google.maps.Marker({
        map,
        position: route.points[0],
        icon: arrowIcon(0),
        zIndex: 9999,
        optimized: false,
      });
    }

    let lastPubT = 0; // 地圖同步：每秒發一次位置
    let lastOrientT = 0; // 羅盤轉動的發送節流
    let lastPos = null; // 最後已知位置 {lat,lng,grade}，供轉手機時重發

    // 手機羅盤轉動 → 箭頭跟著轉，並（站著不動也）把新方向發給後台
    const onOrient = (e) => {
      let h = null;
      if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading; // iOS：直接是羅盤朝向
      else if (e.absolute && typeof e.alpha === "number") h = (360 - e.alpha) % 360; // 一般：alpha 逆時針→轉成順時針
      if (h == null || isNaN(h)) return;
      compassRef.current = h;
      if (riderMarkerRef.current) riderMarkerRef.current.setIcon(arrowIcon(h));
      const nowMs = performance.now();
      if (lastPos && nowMs - lastOrientT > 300) {
        lastOrientT = nowMs;
        publishGps(lastPos.lat, lastPos.lng, h);
      }
    };
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);

    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const here = new google.maps.LatLng(
          p.coords.latitude,
          p.coords.longitude
        );

        // 投影到路線上最近的取樣點 → 得到沿線距離
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < route.points.length; i++) {
          const d = sph.computeDistanceBetween(here, route.points[i]);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        const distM = route.cum[best];
        const grade = slopeAt(route, distM);

        // 速度（GPS 提供 m/s）
        const speed =
          p.coords.speed != null && p.coords.speed >= 0
            ? Math.round(p.coords.speed * 3.6)
            : 0;
        // 方向：優先用手機羅盤朝向（轉手機就轉）；沒有羅盤才退回 GPS 行進方向
        let heading =
          compassRef.current != null
            ? compassRef.current
            : p.coords.heading != null && !isNaN(p.coords.heading)
            ? p.coords.heading
            : gpsPrevRef.current
            ? sph.computeHeading(gpsPrevRef.current, here)
            : 0;
        gpsPrevRef.current = here;
        lastPos = { lat: here.lat(), lng: here.lng(), grade };

        riderMarkerRef.current.setPosition(here);
        riderMarkerRef.current.setIcon(arrowIcon(heading));
        if (MAP_ID) {
          map.moveCamera({ center: here, zoom: 17, tilt: 0, heading: 0 });
        } else {
          map.setCenter(here);
        }

        // 地圖同步：每秒把目前位置發給網頁後台
        const nowMs = performance.now();
        if (nowMs - lastPubT > 1000) {
          lastPubT = nowMs;
          publishGps(here.lat(), here.lng(), heading);
        }

        // 高亮目前路段
        const segEnds = route.segEnds || [];
        let segIdx = segEnds.findIndex((e) => distM <= e);
        if (segIdx === -1) segIdx = segEnds.length - 1;
        if (segIdx !== prevSegIdxRef.current) {
          polylinesRef.current.forEach((pl, i) =>
            pl.setOptions({
              strokeWeight: i === segIdx ? 11 : 6,
              strokeOpacity: i === segIdx ? 1 : 0.5,
              zIndex: i === segIdx ? 10 : 1,
            })
          );
          prevSegIdxRef.current = segIdx;
          // 換段就回報目前所在路段的坡度給 AI 板
          const seg = route.segments?.[segIdx];
          if (seg) sendCan(segmentToFrame(seg));
        }

        // 下一個轉彎
        let instruction = "";
        let maneuver = "straight";
        let turnM = 0;
        if (route.steps && route.steps.length) {
          const legDistDone = route.legDist
            ? (distM / route.total) * route.legDist
            : distM;
          let si = route.stepEnds.findIndex((e) => legDistDone < e);
          if (si === -1) si = route.steps.length - 1;
          const nextStep = route.steps[si + 1];
          instruction = nextStep ? nextStep.instruction : "繼續直行至終點";
          maneuver = nextStep ? nextStep.maneuver : "straight";
          turnM = Math.max(0, route.stepEnds[si] - legDistDone);
        }

        const usedFrac = route.total > 0 ? distM / route.total : 0;
        const battery = Math.max(
          0,
          startBatteryRef.current - route.estUsedPct * usedFrac
        );
        const finished = distM >= route.total * 0.98;

        setSim({
          speed,
          cadence: speed < 2 ? 0 : Math.round(clamp(66 - grade * 0.6, 48, 80)),
          assist: grade > 6 ? 4 : grade > 3 ? 3 : grade > 0 ? 2 : 1,
          battery: +battery.toFixed(1),
          motorTemp: Math.round(34 + Math.max(0, grade)),
          voltage: +(46 + (battery / 100) * 4).toFixed(1),
          remainM: route.total - distM,
          finished,
          instruction: finished ? "已抵達目的地" : instruction,
          maneuver: finished ? "arrive" : maneuver,
          turnM,
          grade: +grade.toFixed(1),
        });
      },
      (err) => {
        if (err.code === 1) alert("需要定位權限才能用 GPS 導航");
        else console.warn("GPS error:", err.message);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, [phase, gps, google]);

  function toggleRide() {
    if (riding) {
      setRiding(false);
      return;
    }
    if (gps) setGps(false); // 停掉 GPS
    // 重新開始（首次或已抵達）
    if (!sim || sim.finished) {
      simRef.current = { distM: 0 };
      startBatteryRef.current = live.battery;
      setSim(null);
    }
    setRiding(true);
  }

  function toggleGps() {
    if (gps) {
      setGps(false);
      return;
    }
    setRiding(false); // 停掉模擬
    startBatteryRef.current = live.battery;
    gpsPrevRef.current = null;
    compassRef.current = null; // 清掉上一次的羅盤朝向
    // iOS 13+ 需在使用者手勢中要一次方向感測器權限，否則 deviceorientation 不會觸發
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      DOE.requestPermission().catch(() => {});
    }
    setGps(true);
  }

  function exitNav() {
    setPhase("preview"); // 結束導航回到路線預覽（不是回表單）
    endMapSync(); // 斷開地圖同步 MQTT
    setRiding(false);
    setGps(false);
    setSim(null);
    simRef.current = { distM: 0 };
    gpsPrevRef.current = null;
    prevSegIdxRef.current = -1;
    polylinesRef.current.forEach((p) =>
      p.setOptions({ strokeWeight: 6, strokeOpacity: 0.95, zIndex: 1 })
    );
    if (mapRef.current) {
      mapRef.current.setTilt?.(0);
      mapRef.current.setHeading?.(0);
    }
    if (riderMarkerRef.current) {
      riderMarkerRef.current.setMap(null);
      riderMarkerRef.current = null;
    }
    if (riderCircleRef.current) {
      riderCircleRef.current.setMap(null);
      riderCircleRef.current = null;
    }
  }

  function cycleSpeed() {
    setSpeedMult((m) => (m === 1 ? 2 : m === 2 ? 4 : 1));
  }

  function clearRoute() {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    endMarkersRef.current.forEach((m) => m.setMap(null));
    endMarkersRef.current = [];
    setSegments([]);
    setSummary(null);
  }

  function showSegmentInfo(seg) {
    const iw = infoWindowRef.current;
    const mid = seg.locs[Math.floor(seg.locs.length / 2)];
    iw.setContent(
      `<div style="font-size:13px;line-height:1.6">
        <b>第 ${seg.index} 段</b><br>
        平均坡度：<b>${seg.grade.toFixed(1)}%</b><br>
        長度：${fmtDist(seg.segDist)}<br>
        高度變化：${seg.elevChange >= 0 ? "+" : ""}${seg.elevChange.toFixed(0)} m<br>
        爬升 ${seg.gain.toFixed(0)} m / 下降 ${seg.loss.toFixed(0)} m
      </div>`
    );
    iw.setPosition(mid);
    iw.open(mapRef.current);
  }

  function drawSegments(segs, fit = true) {
    const bounds = new google.maps.LatLngBounds();
    segs.forEach((seg) => {
      const poly = new google.maps.Polyline({
        path: seg.locs,
        strokeColor: gradeColor(seg.grade),
        strokeOpacity: 0.95,
        strokeWeight: 6,
        map: mapRef.current,
      });
      poly.addListener("click", () => showSegmentInfo(seg));
      polylinesRef.current.push(poly);
      seg.locs.forEach((l) => bounds.extend(l));
    });
    boundsRef.current = bounds;

    // 自己放起/終點標記（取代 DirectionsRenderer 的預設標記）
    endMarkersRef.current.forEach((m) => m.setMap(null));
    endMarkersRef.current = [];
    if (segs.length) {
      const first = segs[0].locs[0];
      const lastSeg = segs[segs.length - 1].locs;
      const last = lastSeg[lastSeg.length - 1];
      endMarkersRef.current = [
        new google.maps.Marker({ position: first, map: mapRef.current, label: "起" }),
        new google.maps.Marker({ position: last, map: mapRef.current, label: "終" }),
      ];
    }

    if (fit) mapRef.current.fitBounds(bounds); // 拖曳微調時不重新框，保留使用者目前視角
  }

  // 取得目前位置 → 反查地址 → 填進起點（第一個 stop）
  function fillCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus({ msg: "此裝置不支援定位", error: true });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude, longitude } = p.coords;
        const coordStr = `${latitude},${longitude}`;
        const apply = (text) => {
          setStops((prev) => prev.map((s, i) => (i === 0 ? text : s)));
          setLocating(false);
        };
        // 有 google 就反查成可讀地址，否則直接用座標（Directions 也吃座標字串）
        if (google) {
          new google.maps.Geocoder().geocode(
            { location: { lat: latitude, lng: longitude } },
            (res, st) =>
              apply(st === "OK" && res?.[0] ? res[0].formatted_address : coordStr)
          );
        } else {
          apply(coordStr);
        }
      },
      (err) => {
        setLocating(false);
        setStatus({
          msg: err.code === 1 ? "需要定位權限才能用目前位置" : "定位失敗，請再試一次",
          error: true,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // 由「規劃路線」按鈕觸發：用表單的地名查路線，成功後進入預覽階段
  async function planRoute() {
    const pts = stops.map((s) => s.trim()).filter(Boolean);
    if (pts.length < 2) {
      setStatus({ msg: "請至少輸入起點與目的地", error: true });
      return;
    }
    setLoading(true);
    setStatus({ msg: "規劃路線中…", error: false });
    clearRoute();

    try {
      const origin = pts[0];
      const destination = pts[pts.length - 1];
      const waypoints = pts
        .slice(1, -1)
        .map((location) => ({ location, stopover: true }));

      const dirResult = await dirServiceRef.current.route({
        origin,
        destination,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING, // 與同學的 PoC 一致（自行車模式會鑽小路、路徑不同）
      });
      await applyDirections(dirResult);
      // 分段完成 → 輸出 txt（route_id/segment_index/segment_distance_m/grade_pct/elevation_delta_m）
      const route = routeRef.current;
      if (route?.segments?.length) {
        const name = `${route.routeId || "segments"}.txt`;
        downloadTxt(name, segmentsToTxt(route.segments, route.routeId));
      }
      setPhase("preview");
    } catch (err) {
      console.error(err);
      const code = err?.code || "";
      let msg;
      if (code === "ZERO_RESULTS") msg = "找不到這兩地之間的路線，換個交通方式試試";
      else if (code === "NOT_FOUND") msg = "找不到地點，請確認地名是否正確";
      else if (code === "REQUEST_DENIED")
        msg = `路線服務被拒絕：API 金鑰未授權此網址（${window.location.origin}）或未啟用 Directions API`;
      else msg = "發生錯誤：" + (err?.message || code || "未知");
      setStatus({ msg, error: true });
      setLoading(false);
    }
  }

  // 從一份路線結果算坡度/電量/轉彎並畫線
  async function applyDirections(dirResult) {
    try {
      dirRendererRef.current.setDirections(dirResult);
      setLoading(true);

      // 清掉舊的彩色坡度線（summary/segments 等新值算好再覆蓋）
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];

      const route = dirResult.routes[0];
      const legs = route.legs; // 多站會有多段
      const totalDurationSec = legs.reduce((a, l) => a + l.duration.value, 0);
      const legDistVal = legs.reduce((a, l) => a + l.distance.value, 0);

      // 用已簡化的 overview_path（涵蓋整條多站路線）
      let path = route.overview_path || [];
      if (path.length < 2) {
        path = [];
        legs.forEach((lg) =>
          lg.steps.forEach((step) => step.path.forEach((pt) => path.push(pt)))
        );
      }

      // 坡度分段是「加分項」：海拔／幾何服務失敗時退回平地，
      // 確保路線摘要與「開始導航」按鈕仍照常出現（不會卡在只有地圖、沒按鈕）。
      let segs = [];
      let totalDist = legDistVal;
      let rpts = path;
      let relevs = path.map(() => 0);
      try {
        const elevResult = await elevServiceRef.current.getElevationAlongPath({
          path,
          samples: 512,
        });
        const built = buildAutoSegments(google, elevResult.results);
        segs = built.segments;
        totalDist = built.totalDist;
        rpts = elevResult.results.map((r) => r.location);
        relevs = elevResult.results.map((r) => r.elevation);
        drawSegments(segs);
      } catch (slopeErr) {
        console.warn("坡度分段失敗，改用平地估算：", slopeErr);
        setStatus({ msg: "坡度資料暫時無法取得，已用平地估算距離/電量", error: false });
        // 退回：畫一條單色路線並框住，確保地圖上仍看得到路徑
        const line = new google.maps.Polyline({
          path,
          strokeColor: "#3a7d55",
          strokeOpacity: 0.95,
          strokeWeight: 6,
          map: mapRef.current,
        });
        polylinesRef.current.push(line);
        const b = new google.maps.LatLngBounds();
        path.forEach((p) => b.extend(p));
        boundsRef.current = b;
        mapRef.current.fitBounds(b);
      }

      setSegments(segs);
      const totalGain = segs.reduce((a, s) => a + s.gain, 0);
      const estUsedPct = estimateUsedPct({
        distanceM: totalDist,
        gainM: totalGain,
        weightKg: weightRef.current,
      });

      // 先設 summary → 底部路線卡（含「開始導航」按鈕）一定會出現。
      // 這些欄位都不依賴 geometry / 海拔，所以就算下面模擬資料失敗也不影響按鈕。
      setSummary({
        totalDist,
        duration: fmtDur(totalDurationSec),
        durationSec: totalDurationSec,
        eta: arrivalTime(totalDurationSec),
        totalGain,
        totalLoss: segs.reduce((a, s) => a + s.loss, 0),
        maxGrade: segs.length ? Math.max(...segs.map((s) => s.grade)) : 0,
        estUsedPct,
      });

      // 存一份給模擬騎乘 / 地圖同步用的路線資料（依賴 geometry 服務，屬加分項）。
      // 這段若失敗，不能連帶讓 summary/按鈕消失，所以獨立 try 包起來。
      try {
        const rcum = cumDistances(google, rpts);
        let acc = 0;
        const segEnds = segs.map((s) => (acc += s.segDist)); // 每段的累計結束距離

        // 逐步轉彎指示（合併所有 leg 的 steps）
        let sacc = 0;
        const steps = legs
          .flatMap((lg) => lg.steps)
          .map((st) => ({
            instruction: stripHtml(st.instructions),
            maneuver: st.maneuver || "",
            distVal: st.distance.value,
          }));
        const stepEnds = steps.map((s) => (sacc += s.distVal));

        // route_id：該趟導航的唯一識別碼（時間戳記式，每次規劃各不相同）
        const routeId = makeRouteId();

        // 起終點地名（給地圖同步的 from/to 用）
        const namedStopsNow = stops.map((s) => s.trim()).filter(Boolean);

        // 給網頁地圖同步用：整條路徑壓成 encoded polyline + 起終點/摘要文字
        routeRef.current = {
          points: rpts,
          elevs: relevs,
          cum: rcum,
          total: rcum[rcum.length - 1],
          estUsedPct,
          segEnds,
          segments: segs, // 路段坡度資料，進導航時上傳 CAN
          routeId,
          steps,
          stepEnds,
          legDist: legDistVal,
          // 地圖同步發送用
          polyline: google.maps.geometry.encoding.encodePath(path),
          from: namedStopsNow[0] || "起點",
          to: namedStopsNow[namedStopsNow.length - 1] || "終點",
          distText: fmtDist(totalDist),
          durText: fmtDur(totalDurationSec),
          // 整條路的分段坡度（與 CAN 輸出同源）＋每段幾何，讓後台照坡度上色
          segProfile: segs.map((s) => ({
            i: s.index,
            distM: Math.round(s.segDist),
            grade: +s.grade.toFixed(1),
            elevDelta: +s.elevChange.toFixed(1),
            poly: google.maps.geometry.encoding.encodePath(s.locs),
          })),
          maxGrade: segs.length ? Math.max(...segs.map((s) => s.grade)) : 0,
        };
      } catch (simErr) {
        console.warn("模擬/地圖同步資料建立失敗（不影響導航按鈕）：", simErr);
      }

      setStatus({
        msg: `完成！自動依坡度分成 ${segs.length} 段`,
        error: false,
      });
    } catch (err) {
      console.error(err);
      setStatus({
        msg: "路線計算失敗：" + (err?.message || err?.code || "未知"),
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }

  function focusSegment(seg) {
    mapRef.current.panTo(seg.locs[Math.floor(seg.locs.length / 2)]);
    showSegmentInfo(seg);
  }

  // 預覽列要顯示的起點 / 終點 / 途經點數
  const namedStops = stops.map((s) => s.trim()).filter(Boolean);
  const firstStop = namedStops[0] || "起點";
  const lastStop = namedStops[namedStops.length - 1] || "終點";
  const midCount = Math.max(0, namedStops.length - 2);

  return (
    <div
      className={`dash mode-enter ${phase === "nav" ? "nav" : ""}`}
      style={{ "--enter-color": "#eaf5ed" }}
    >
      {/* 進場罩：起始為主畫面擴散的同色，再淡開→無縫接續，不會黑/灰閃一下 */}
      <div className="mode-veil" aria-hidden="true" />
      <main id="map" ref={mapDivRef} />

      {/* 返回主畫面（導航階段交給 NavOverlay 的結束鈕） */}
      {phase !== "nav" && (
        <button className="mode-back" onClick={onBack} aria-label="返回主畫面">
          ‹ 主畫面
        </button>
      )}

      {/* 第一步：填表單，先不顯示地圖（用整頁面板蓋住） */}
      {phase === "form" && (
        <div className="route-form-screen">
          <h1 className="rs-header">電量管理模式</h1>
          <RouteForm
            stops={stops}
            setStops={setStops}
            ready={!!google}
            loading={loading}
            locating={locating}
            onUseCurrentLocation={fillCurrentLocation}
            status={loadError ? { msg: loadError, error: true } : status}
            onPlan={planRoute}
          />
        </div>
      )}

      {/* 第二步：地圖 + 起終點 + 坡度路段，點開始導航才進車況 */}
      {phase === "preview" && (
        <>
          <div
            className="search collapsed route-edit-bar"
            onClick={() => setPhase("form")}
          >
            <span className="oneline">
              <b>📍 {firstStop}</b>
              {midCount > 0 && <span className="mid"> · 經 {midCount} 點</span>}
              <span className="arrow">→</span>
              <b>🏁 {lastStop}</b>
            </span>
            <span className="edit">✎</span>
          </div>

          {summary && (
            <RouteSheet
              summary={summary}
              live={live}
              onStartNav={() => setPhase("nav")}
            />
          )}
        </>
      )}

      {/* 第三步：開始導航 → 車況儀表板 */}
      {phase === "nav" && (
        <NavOverlay
          live={sim || live}
          summary={summary}
          riding={riding}
          gps={gps}
          remainM={sim?.remainM}
          finished={sim?.finished}
          speedMult={speedMult}
          onCycleSpeed={cycleSpeed}
          onToggleRide={toggleRide}
          onToggleGps={toggleGps}
          onExit={exitNav}
        />
      )}
    </div>
  );
}
