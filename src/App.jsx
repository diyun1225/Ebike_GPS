import { useEffect, useRef, useState } from "react";
import { useGoogleMaps } from "./useGoogleMaps.js";
import { buildSegments, buildAutoSegments, gradeColor, fmtDist } from "./slope.js";
import { estimateUsedPct, arrivalTime } from "./battery.js";
import { useLiveTelemetry } from "./useLiveTelemetry.js";
import Telemetry from "./components/Telemetry.jsx";
import SearchPanel from "./components/SearchPanel.jsx";
import RouteSheet from "./components/RouteSheet.jsx";
import NavOverlay from "./components/NavOverlay.jsx";

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

// 距離 d 處的坡度(%)
function slopeAt(route, d) {
  const { cum, elevs } = route;
  const i = segIndexAt(cum, d);
  const run = cum[i + 1] - cum[i];
  if (run <= 0) return 0;
  return ((elevs[i + 1] - elevs[i]) / run) * 100;
}

export default function App() {
  const { google, error: loadError } = useGoogleMaps(API_KEY);
  const live = useLiveTelemetry();

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const dirServiceRef = useRef(null);
  const dirRendererRef = useRef(null);
  const elevServiceRef = useRef(null);
  const polylinesRef = useRef([]);
  const infoWindowRef = useRef(null);
  const boundsRef = useRef(null);

  const [segments, setSegments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState({ msg: "", error: false });
  const [loading, setLoading] = useState(false);
  const [navMode, setNavMode] = useState(false);
  const [riding, setRiding] = useState(false);
  const [sim, setSim] = useState(null); // 騎乘中的即時數據
  const [speedMult, setSpeedMult] = useState(1); // 加速播放倍率
  const [gps, setGps] = useState(false); // 真實 GPS 導航
  const gpsPrevRef = useRef(null); // 前一個 GPS 位置（算方向用）

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
    });
    dirServiceRef.current = new google.maps.DirectionsService();
    dirRendererRef.current = new google.maps.DirectionsRenderer({
      map: mapRef.current,
      suppressPolyline: true,
    });
    elevServiceRef.current = new google.maps.ElevationService();
    infoWindowRef.current = new google.maps.InfoWindow();
  }, [google]);

  // 切換導航/規劃時，叫地圖重繪、重新框住路線，並推一下強制補載破圖磚塊
  useEffect(() => {
    if (!mapRef.current || !google) return;
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
  }, [navMode, google, summary]);

  // 模擬騎乘：沿路線推進，速度/踏頻/輔助/電量隨坡度變化
  useEffect(() => {
    if (!navMode || !riding || !routeRef.current || !google) return;
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
  }, [navMode, riding, google, speedMult]);

  // 真實 GPS 導航：用手機定位移動，並把位置對應到規劃路線算坡度/剩餘/轉彎
  useEffect(() => {
    if (!navMode || !gps || !routeRef.current || !google) return;
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
        // 方向（GPS heading，靜止時用上一點推算）
        let heading =
          p.coords.heading != null && !isNaN(p.coords.heading)
            ? p.coords.heading
            : gpsPrevRef.current
            ? sph.computeHeading(gpsPrevRef.current, here)
            : 0;
        gpsPrevRef.current = here;

        riderMarkerRef.current.setPosition(here);
        riderMarkerRef.current.setIcon(arrowIcon(heading));
        if (MAP_ID) {
          map.moveCamera({ center: here, zoom: 17, tilt: 0, heading: 0 });
        } else {
          map.setCenter(here);
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

    return () => navigator.geolocation.clearWatch(watchId);
  }, [navMode, gps, google]);

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
    setGps(true);
  }

  function exitNav() {
    setNavMode(false);
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

  function drawSegments(segs) {
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
    mapRef.current.fitBounds(bounds);
  }

  async function planRoute({ stops, mode, auto, weightKg }) {
    const pts = (stops || []).filter(Boolean);
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
        travelMode: google.maps.TravelMode[mode],
      });
      dirRendererRef.current.setDirections(dirResult);

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

      const elevResult = await elevServiceRef.current.getElevationAlongPath({
        path,
        samples: 512,
      });

      const { segments: segs, totalDist } = auto
        ? buildAutoSegments(google, elevResult.results)
        : buildSegments(google, elevResult.results, 10);

      drawSegments(segs);
      setSegments(segs);
      const totalGain = segs.reduce((a, s) => a + s.gain, 0);
      const estUsedPct = estimateUsedPct({
        distanceM: totalDist,
        gainM: totalGain,
        weightKg,
      });

      // 存一份給模擬騎乘用的路線資料
      const rpts = elevResult.results.map((r) => r.location);
      const relevs = elevResult.results.map((r) => r.elevation);
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

      routeRef.current = {
        points: rpts,
        elevs: relevs,
        cum: rcum,
        total: rcum[rcum.length - 1],
        estUsedPct,
        segEnds,
        steps,
        stepEnds,
        legDist: legDistVal,
      };

      setSummary({
        totalDist,
        duration: fmtDur(totalDurationSec),
        durationSec: totalDurationSec,
        eta: arrivalTime(totalDurationSec),
        totalGain,
        totalLoss: segs.reduce((a, s) => a + s.loss, 0),
        maxGrade: Math.max(...segs.map((s) => s.grade)),
        estUsedPct,
      });
      setStatus({
        msg: auto
          ? `完成！自動依坡度分成 ${segs.length} 段`
          : `完成！共 ${segs.length} 段`,
        error: false,
      });
    } catch (err) {
      console.error(err);
      const code = err?.code || "";
      let msg;
      if (code === "ZERO_RESULTS") msg = "找不到這兩地之間的路線，換個交通方式試試";
      else if (code === "NOT_FOUND") msg = "找不到地點，請確認地名是否正確";
      else msg = "發生錯誤：" + (err?.message || code || "未知");
      setStatus({ msg, error: true });
    } finally {
      setLoading(false);
    }
  }

  function focusSegment(seg) {
    mapRef.current.panTo(seg.locs[Math.floor(seg.locs.length / 2)]);
    showSegmentInfo(seg);
  }

  return (
    <div className={`dash ${navMode ? "nav" : ""}`}>
      <main id="map" ref={mapDivRef} />

      {!navMode && (
        <>
          <Telemetry live={live} />
          <SearchPanel
            ready={!!google}
            loading={loading}
            status={loadError ? { msg: loadError, error: true } : status}
            summary={summary}
            onPlan={planRoute}
          />
          {summary && (
            <RouteSheet
              summary={summary}
              segments={segments}
              live={live}
              onFocusSegment={focusSegment}
              onStartNav={() => setNavMode(true)}
            />
          )}
        </>
      )}

      {navMode && (
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
