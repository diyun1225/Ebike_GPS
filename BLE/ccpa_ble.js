/*
 * ccpa_ble.js — 把「Web Bluetooth 連線 + 解封包」包成一個函式,方便整合進任何網頁。
 * 依賴 ccpa_decode.js(要先載入)。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────────
 *   <script src="ccpa_decode.js"></script>
 *   <script src="ccpa_ble.js"></script>
 *   <button id="btn">連線</button>
 *   <script>
 *     document.getElementById("btn").onclick = async () => {
 *       await ccpaBleConnect({
 *         onData:  (s) => { console.log(s.speedKph, s.batterySocPct); },  // 每筆解碼後
 *         onStatus:(t) => { console.log("狀態:", t); },
 *         onRaw:   (line) => { ... 想看原始 frame 才用 ... },
 *       });
 *     };
 *   </script>
 *
 * ⚠️ Web Bluetooth 限制:
 *   - 必須 HTTPS(或 localhost);iPhone 要用 Bluefy 瀏覽器。
 *   - connect 必須由「使用者點擊」觸發(放在 onclick 裡)。
 *   - 一個板子一次只能一個連線。
 *
 * ── 回傳 ───────────────────────────────────────────────────────────────────
 *   ccpaBleConnect() 回傳 { device, decoder, disconnect() }
 *     decoder.snapshot() 也可隨時自己拿最新狀態;disconnect() 主動斷線。
 */
(function (root) {
  "use strict";

  const SERVICE = "0000cc01-c3d5-40b4-ab51-611746a316f3";
  const TX = "0000cc03-c3d5-40b4-ab51-611746a316f3";

  async function ccpaBleConnect(opts) {
    opts = opts || {};
    const onData = opts.onData || function () {};
    const onRaw = opts.onRaw || function () {};
    const onStatus = opts.onStatus || function () {};
    const deviceName = opts.deviceName || "CCPA-Telemetry";

    if (!navigator.bluetooth) {
      throw new Error("此瀏覽器不支援 Web Bluetooth(iPhone 請用 Bluefy)");
    }
    if (typeof CcpaDecoder === "undefined") {
      throw new Error("找不到 CcpaDecoder — 請先載入 ccpa_decode.js");
    }

    const dec = new CcpaDecoder();
    const td = new TextDecoder();
    let buf = "";

    onStatus("掃描中…請選 " + deviceName);
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: deviceName }],
      optionalServices: [SERVICE],
    });
    device.addEventListener("gattserverdisconnected", () => onStatus("已斷線"));

    onStatus("連線中…");
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    const tx = await service.getCharacteristic(TX);
    await tx.startNotifications();

    tx.addEventListener("characteristicvaluechanged", (e) => {
      buf += td.decode(e.target.value);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        onRaw(line);
        if (dec.feed(line)) {
          onData(dec.snapshot(), dec); // 每收到一包就回報最新解碼結果
        }
      }
    });

    onStatus("已連線");
    return {
      device: device,
      decoder: dec,
      disconnect: function () {
        if (device.gatt.connected) device.gatt.disconnect();
      },
    };
  }

  root.ccpaBleConnect = ccpaBleConnect;
})(typeof globalThis !== "undefined" ? globalThis : this);
