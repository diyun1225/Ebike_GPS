/*
 * ccpaBle.js — Web Bluetooth 連線 + 解封包，ESM 版本。
 * 改自專案根目錄 BLE/ccpa_ble.js（邏輯不變，只換成 import/export）。
 *
 *   import { ccpaBleConnect } from "./ble/ccpaBle.js";
 *   const conn = await ccpaBleConnect({
 *     onData:   (s) => { ... 每筆解碼後的 snapshot ... },
 *     onStatus: (t) => { ... 狀態文字 ... },
 *   });
 *   conn.disconnect();  // 主動斷線
 *
 * ⚠️ Web Bluetooth 限制：
 *   - 必須 HTTPS（或 localhost）；iPhone 要用 Bluefy 瀏覽器。
 *   - connect 必須由「使用者點擊」觸發（放在 onclick 裡）。
 *   - 一個板子一次只能一個連線。
 */
import { CcpaDecoder } from "./ccpaDecode.js";
import { pickVitals } from "../../../ble/vitalsBle.js";

const SERVICE = "0000cc01-c3d5-40b4-ab51-611746a316f3";
const TX = "0000cc03-c3d5-40b4-ab51-611746a316f3"; // esp -> host（notify）車況
const RX = "0000cc02-c3d5-40b4-ab51-611746a316f3"; // host -> esp（write）控制指令

export async function ccpaBleConnect(opts) {
  opts = opts || {};
  const onData = opts.onData || function () {};
  const onRaw = opts.onRaw || function () {};
  const onFrame = opts.onFrame || function () {}; // 每筆解析成功的 {id,dlc,data}（給上層自行判斷 ACK 等）
  const onVitals = opts.onVitals || function () {}; // 毫米波生理量測 {hr,rr,fi}（JSON 行，非 CAN）
  const onStatus = opts.onStatus || function () {};
  const onLog = opts.onLog || function () {}; // 診斷 log：①~⑧ 每步都記，方便在手機上看卡在哪
  const deviceName = opts.deviceName || "CCPA-Telemetry";

  if (!navigator.bluetooth) {
    onLog("✗ 此瀏覽器沒有 Web Bluetooth");
    throw new Error("此瀏覽器不支援 Web Bluetooth（iPhone 請用 Bluefy）");
  }

  const dec = new CcpaDecoder();
  const td = new TextDecoder();
  let buf = "";
  let notifyCount = 0;

  onLog("① 開始掃描…請在彈窗自己挑 " + deviceName);
  onStatus("掃描中…請在清單挑 " + deviceName);
  // 用 acceptAllDevices 列出所有 BLE 裝置，讓使用者自己挑。
  // （名稱過濾 filters:[{name}] 在部分裝置/瀏覽器會掃不到，先用全列的方式確保挑得到。）
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICE],
  });
  onLog("② 已選裝置：" + (device.name || device.id));
  device.addEventListener("gattserverdisconnected", () => {
    onLog("✗ 裝置斷線");
    onStatus("已斷線");
  });

  onLog("③ 連線 GATT…");
  onStatus("連線中…");
  const server = await device.gatt.connect();
  onLog("④ 取得服務（0000cc01…）");
  const service = await server.getPrimaryService(SERVICE);
  onLog("⑤ 取得 TX 特徵（0000cc03…）");
  const tx = await service.getCharacteristic(TX);
  onLog("⑥ 開啟 notify…");
  await tx.startNotifications();

  tx.addEventListener("characteristicvaluechanged", (e) => {
    const bytes = e.target.value; // DataView
    const text = td.decode(bytes);
    notifyCount++;
    onLog(`⑦ 收到 BLE #${notifyCount}（${bytes.byteLength} bytes）: ${JSON.stringify(text)}`);

    buf += text;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      onRaw(line);

      // 毫米波生理量測是純 JSON 一行（{ 開頭），不是 ID= 的 CAN 封包 → 解 hr/rr/fi。
      // （對照 BLE/ble_phone.html 的 onNotify：mmWave JSON 跟 CAN frame 混在同一條 TX。）
      if (line[0] === "{") {
        try {
          const v = pickVitals(JSON.parse(line));
          if (v) { onVitals(v); onLog("♥ 生理量測：" + line); }
          continue;
        } catch {
          // 不是完整 JSON（可能被 BLE 切斷）→ 往下當碎片處理
        }
      }

      const f = CcpaDecoder.parseRawLine(line);
      if (!f) {
        onLog("⑧ ✗ 解析失敗（格式不符）：" + JSON.stringify(line));
        continue;
      }
      onLog(
        `⑧ 解析 OK：id=0x${f.id.toString(16).toUpperCase()} dlc=${f.dlc} data=[${f.data
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")}]`
      );
      onFrame(f); // 先把原始解析結果丟給上層（例：MODEACK 確認）
      dec.feed(line); // 解封包
      onData(dec.snapshot(), dec); // 每收到一包就回報最新解碼結果
    }
  });

  // 取得 RX 特徵以送控制指令（升降檔 / 助力段位）。有些板子可能沒有，失敗不影響接收。
  let rxChar = null;
  try {
    rxChar = await service.getCharacteristic(RX);
    onLog("⑥b 取得 RX 特徵（0000cc02…）→ 可送控制指令");
  } catch (e) {
    onLog("⚠ 沒有 RX 特徵，無法送控制指令：" + (e?.message || e));
  }
  const enc = new TextEncoder();

  onLog("✅ 訂閱成功！等板子送資料。若之後一直沒『⑦』= 板子沒在送 = 沒收到 CAN（硬體那側）");
  onStatus("已連線");
  return {
    device,
    decoder: dec,
    canControl: !!rxChar,
    // 送一行控制指令（例："SHIFT,UP" / "ASSIST,3" / "CAN,2940015,2,02,03"）
    async sendCommand(cmd) {
      if (!rxChar) throw new Error("此裝置沒有 RX 特徵，無法送控制指令");
      const bytes = enc.encode(cmd + "\n"); // 韌體以換行分隔指令
      // 優先用免回應（較快）；不支援才用一般 write
      if (rxChar.writeValueWithoutResponse)
        await rxChar.writeValueWithoutResponse(bytes);
      else await rxChar.writeValue(bytes);
      onLog("→ 已送指令：" + cmd);
    },
    disconnect() {
      if (device.gatt.connected) device.gatt.disconnect();
    },
  };
}
