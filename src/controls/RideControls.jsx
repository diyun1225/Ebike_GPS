// 騎乘手動控制：浮在任何模式上的小球，點開可調變速 / 避震 / 輔助力。
// 顯示哪些項目依模式而定（見 rideControlsConfig.js）。用共用 BLE 連線送指令、
// 讀遙測。沒連線時仍可操作（純畫面回饋），連上後即真的送 CAN。
import { useEffect, useRef, useState } from "react";
import { useBle } from "../ble/BleContext.jsx";
import ballIcon from "../assets/settings.png";
import {
  RIDE_CONTROLS_BY_MODE,
  AUTO_CONTROLLED_BY_MODE,
  CONTROL_LABEL,
  ASSIST_MIN,
  ASSIST_MAX,
  SUSPENSION_MIN,
  SUSPENSION_MAX,
  SHIFT_FALLBACK_MAX,
} from "./rideControlsConfig.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DRAG_THRESHOLD = 6; // 移動超過這個距離才算「拖曳」而非「點擊」

export default function RideControls({ mode }) {
  const ble = useBle();
  const items = RIDE_CONTROLS_BY_MODE[mode] || [];
  const [open, setOpen] = useState(false);
  const [ballY, setBallY] = useState(0.5); // 小球的垂直位置（0~1）
  const [ballSide, setBallSide] = useState("right"); // 貼哪一側：left / right（給左撇子）

  // 本地控制值（樂觀更新，畫面立即反應）；有遙測時以遙測為準
  const [assist, setAssistLocal] = useState(0);
  const [susp, setSuspLocal] = useState(0);
  const [gear, setGearLocal] = useState(1);

  const snap = ble.data;
  const gearMax = snap?.rearGear?.max || SHIFT_FALLBACK_MAX;

  // 遙測有值就同步過來（輔助力、目前檔位是「車子說了算」）
  useEffect(() => {
    if (snap?.assistLevel != null) setAssistLocal(snap.assistLevel);
    else if (ble.commandedAssist != null) setAssistLocal(ble.commandedAssist);
  }, [snap?.assistLevel, ble.commandedAssist]);
  useEffect(() => {
    if (snap?.rearGear?.index != null) setGearLocal(snap.rearGear.index);
  }, [snap?.rearGear?.index]);
  useEffect(() => {
    if (ble.commandedSuspension != null) setSuspLocal(ble.commandedSuspension);
  }, [ble.commandedSuspension]);

  // 換模式時收合，避免停在上一個模式的展開狀態
  useEffect(() => setOpen(false), [mode]);

  // ── 小球拖曳：垂直可自由移動，水平放開時吸附到最近一側（左/右緣）──
  const dragRef = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    frameH: 0,
    shellLeft: 0,
    shellW: 0,
  });
  const onPointerDown = (e) => {
    // 以手機框（.app-shell）為基準，這樣吸附的是 App 畫面的左右緣而非瀏覽器視窗
    const shell = e.currentTarget.closest(".app-shell");
    const rect = shell
      ? shell.getBoundingClientRect()
      : { height: window.innerHeight, left: 0, width: window.innerWidth };
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      frameH: rect.height,
      shellLeft: rect.left,
      shellW: rect.width,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    if (
      Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD ||
      Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD
    )
      d.moved = true;
    if (d.moved) {
      const frac = clamp(ballY + (e.clientY - d.startY) / d.frameH, 0.08, 0.92);
      setBallY(frac);
      d.startY = e.clientY;
      // 指標過了框中線就換邊（即時吸附，放開後停在該側）
      const mid = d.shellLeft + d.shellW / 2;
      setBallSide(e.clientX < mid ? "left" : "right");
    }
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    d.dragging = false;
    if (!d.moved) setOpen((v) => !v); // 沒拖動 = 點擊 → 開關面板
  };

  if (items.length === 0) return null;

  const autoKey = AUTO_CONTROLLED_BY_MODE[mode];
  const connected = ble.phase === "connected" && ble.canControl;

  // ── 各控制項送出 + 樂觀更新 ──
  const doAssist = (v) => {
    const lv = clamp(v, ASSIST_MIN, ASSIST_MAX);
    setAssistLocal(lv);
    ble.setAssist(lv);
  };
  const doSusp = (v) => {
    const lv = clamp(v, SUSPENSION_MIN, SUSPENSION_MAX);
    setSuspLocal(lv);
    ble.setSuspension(lv);
  };
  const doShift = (dir) => {
    setGearLocal((g) => clamp(g + dir, 1, gearMax));
    if (dir > 0) ble.shiftUp();
    else ble.shiftDown();
  };

  return (
    <>
      {open && <div className="rc-scrim" onClick={() => setOpen(false)} />}

      <button
        className={`rc-ball ${ballSide} ${open ? "open" : ""}`}
        style={{ top: `${ballY * 100}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="手動控制"
      >
        <img className="rc-ball-ico" src={ballIcon} alt="手動控制" draggable="false" />
      </button>

      {open && (
        <div
          className={`rc-card ${ballSide}`}
          style={{ top: `${clamp(ballY, 0.12, 0.7) * 100}%` }}
        >
          <div className="rc-card-head">
            <span>手動控制</span>
            <button className="rc-close" onClick={() => setOpen(false)} aria-label="關閉">
              ✕
            </button>
          </div>

          {items.includes("shift") && (
            <div className="rc-row">
              <div className="rc-row-label">變速</div>
              <div className="rc-stepper">
                <button className="rc-step" onClick={() => doShift(-1)} aria-label="降檔">
                  −
                </button>
                <div className="rc-val">
                  <b>{gear}</b>
                  <span>／{gearMax} 檔</span>
                </div>
                <button className="rc-step" onClick={() => doShift(+1)} aria-label="升檔">
                  ＋
                </button>
              </div>
            </div>
          )}

          {items.includes("suspension") && (
            <div className="rc-row">
              <div className="rc-row-label">
                避震 <span className="rc-hint">軟 ‹ › 硬</span>
              </div>
              <div className="rc-seg">
                {Array.from({ length: SUSPENSION_MAX - SUSPENSION_MIN + 1 }).map((_, i) => {
                  const lv = SUSPENSION_MIN + i;
                  return (
                    <button
                      key={lv}
                      className={`rc-seg-btn ${susp === lv ? "on" : ""}`}
                      onClick={() => doSusp(lv)}
                    >
                      {lv}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {items.includes("assist") && (
            <div className="rc-row">
              <div className="rc-row-label">輔助力</div>
              <div className="rc-stepper">
                <button className="rc-step" onClick={() => doAssist(assist - 1)} aria-label="減輔助">
                  −
                </button>
                <div className="rc-val">
                  <b>{assist}</b>
                  <span>／{ASSIST_MAX} 段</span>
                </div>
                <button className="rc-step" onClick={() => doAssist(assist + 1)} aria-label="加輔助">
                  ＋
                </button>
              </div>
            </div>
          )}

          <div className="rc-foot">
            {autoKey ? (
              <>⚡ {CONTROL_LABEL[autoKey]}由此模式自動控制</>
            ) : (
              <>三項皆可手動調整</>
            )}
            {!connected && <span className="rc-foot-off">・未連線（僅畫面預覽）</span>}
          </div>
        </div>
      )}
    </>
  );
}
