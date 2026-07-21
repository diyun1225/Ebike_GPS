// 騎乘手動控制：固定在畫面最下方的控制面板（隨時可調，不用先點開）。
// 三個控制「左右並排」，每個控制的 ＋/− 改成「上下擺」（＋ 在上、− 在下）：
// 整排上方全是 ＋、下方全是 −，手指往旁邊滑也只會碰到「同方向」的鈕，
// 不會發生「想升變速卻按到避震減檔」這種相反操作的誤觸。
// 顯示哪些項目依模式而定（見 rideControlsConfig.js）；目前只有一般模式使用，
// 其餘模式的變速/避震/輔助力都由該模式在背景自動控制。
import { useEffect, useRef, useState } from "react";
import { useBle } from "../ble/BleContext.jsx";
import {
  RIDE_CONTROLS_BY_MODE,
  ASSIST_MIN,
  ASSIST_MAX,
  SUSPENSION_MIN,
  SUSPENSION_MAX,
  SHIFT_MIN,
  SHIFT_MAX,
  SHIFT_FALLBACK_MAX,
} from "./rideControlsConfig.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 一格控制（直向）：＋(上) — 標題+數值(中) — −(下)。三格並排時 ＋ 全在上排、− 全在下排。
function ControlCell({ label, hint, value, unit, onDec, onInc, decDisabled, incDisabled }) {
  return (
    <div className="rc-cell">
      <div className="rc-cell-label">
        {label}
        {hint && <span className="rc-cell-hint">{hint}</span>}
      </div>
      <button className="rc-vstep" onClick={onInc} disabled={incDisabled} aria-label={`${label}加`}>
        ＋
      </button>
      <div className="rc-cell-val">
        <b>{value}</b>
        {unit && <i>{unit}</i>}
      </div>
      <button className="rc-vstep" onClick={onDec} disabled={decDisabled} aria-label={`${label}減`}>
        −
      </button>
    </div>
  );
}

export default function RideControls({ mode }) {
  const ble = useBle();
  const items = RIDE_CONTROLS_BY_MODE[mode] || [];

  // 本地控制值（樂觀更新，畫面立即反應）；有遙測時以遙測為準
  const [assist, setAssistLocal] = useState(0);
  const [susp, setSuspLocal] = useState(SUSPENSION_MIN);
  const [gear, setGearLocal] = useState(SHIFT_MIN);

  const snap = ble.data;
  // 變速上限：車子回報的 GearRange 為準，但不超過開放的 SHIFT_MAX；沒遙測用備援
  const gearMax = Math.min(snap?.rearGear?.max || SHIFT_FALLBACK_MAX, SHIFT_MAX);

  // 剛手動調過輔助力後，這個時間點之前先信本地值。
  // 段位來源是 bus 上的 ASSISTREQ 指令回音，送出到收到回音有延遲；這段期間先顯示
  // 本地值，避免畫面短暫跳回上一個指令值。（對照 ble_phone.html 變速的 gearHoldUntil）
  const ASSIST_HOLD_MS = 1500;
  const assistHoldRef = useRef(0);

  // 遙測有值就同步（輔助力、目前檔位是「車子說了算」）
  useEffect(() => {
    if (Date.now() < assistHoldRef.current) return; // 剛手動調整過，先不被拉回
    if (snap?.assistLevel != null) setAssistLocal(snap.assistLevel);
    else if (ble.commandedAssist != null) setAssistLocal(ble.commandedAssist);
  }, [snap?.assistLevel, ble.commandedAssist]);
  useEffect(() => {
    if (snap?.rearGear?.index != null) setGearLocal(clamp(snap.rearGear.index, SHIFT_MIN, SHIFT_MAX));
  }, [snap?.rearGear?.index]);
  useEffect(() => {
    if (ble.commandedSuspension != null) setSuspLocal(ble.commandedSuspension);
  }, [ble.commandedSuspension]);
  // 前叉回報（0x294003C）有值就以車子為準（0x80 歸零段夾回可控下限 1）
  const forkLevel = snap?.fork?.level;
  useEffect(() => {
    if (forkLevel != null) setSuspLocal(clamp(forkLevel, SUSPENSION_MIN, SUSPENSION_MAX));
  }, [forkLevel]);

  if (items.length === 0) return null;

  const connected = ble.phase === "connected" && ble.canControl;

  const doAssist = (v) => {
    const lv = clamp(v, ASSIST_MIN, ASSIST_MAX);
    assistHoldRef.current = Date.now() + ASSIST_HOLD_MS; // 先信本地值，別被遙測拉回
    setAssistLocal(lv);
    ble.setAssist(lv);
  };
  const doSusp = (v) => {
    const lv = clamp(v, SUSPENSION_MIN, SUSPENSION_MAX);
    setSuspLocal(lv);
    ble.setSuspension(lv);
  };

  // 前叉狀態顯示：移動/歸零中顯示「…」；狀態碼異常時提示文字取代「軟↔硬」
  const fork = snap?.fork;
  const forkErrText = { 1: "堵轉/逾時", 2: "歸零失敗", 3: "尚未歸零" }[fork?.status];
  const suspHint = fork?.moving ? "移動中…" : forkErrText || "軟↔硬";
  // 畫面值：車子回報的目前段位優先（含 0x80 顯示 0），沒有回報才用本地樂觀值
  const suspShown = fork?.moving ? "…" : fork?.level ?? susp;
  const doShift = (dir) => {
    setGearLocal((g) => clamp(g + dir, SHIFT_MIN, gearMax));
    if (dir > 0) ble.shiftUp();
    else ble.shiftDown();
  };

  return (
    <div className="rc-bar">
      {!connected && <div className="rc-bar-off">未連線·預覽</div>}
      {items.includes("shift") && (
        <ControlCell
          label="變速"
          value={gear}
          unit={`／${gearMax}`}
          onDec={() => doShift(-1)}
          onInc={() => doShift(+1)}
          decDisabled={gear <= SHIFT_MIN}
          incDisabled={gear >= gearMax}
        />
      )}
      {items.includes("suspension") && (
        <ControlCell
          label="避震"
          hint={suspHint}
          value={suspShown}
          onDec={() => doSusp(susp - 1)}
          onInc={() => doSusp(susp + 1)}
          decDisabled={fork?.moving || susp <= SUSPENSION_MIN}
          incDisabled={fork?.moving || susp >= SUSPENSION_MAX}
        />
      )}
      {items.includes("assist") && (
        <ControlCell
          label="輔助力"
          value={assist}
          onDec={() => doAssist(assist - 1)}
          onInc={() => doAssist(assist + 1)}
          decDisabled={assist <= ASSIST_MIN}
          incDisabled={assist >= ASSIST_MAX}
        />
      )}
    </div>
  );
}
