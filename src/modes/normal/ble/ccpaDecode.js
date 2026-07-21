/*
 * CcpaDecoder — CCPA CAN 解封包器（把原始 CAN frame 解析成車況數值）
 * ESM 版本，改自專案根目錄 BLE/ccpa_decode.js（邏輯不變，只換成 export）。
 * 參考自 sdkTest/src/ccpa_telemetry.c。
 *
 *   import { CcpaDecoder } from "./ble/ccpaDecode.js";
 *   const dec = new CcpaDecoder();
 *   dec.feed("ID=0x29404FC DLC=6 DATA=C4 09 DC 05 50 00");
 *   dec.snapshot();   // { speedKph: 25, cadenceRpm: 80, ... }
 */

// CAN ID（對應 ccpa_telemetry.c 的 #define）。同一筆資料常有 ACK / BRO 兩個 ID，內容相同。
const ID = {
  GENERAL_INFO00ACK: 0x29404fc, GENERAL_INFO00BRO: 0x29404fe,
  GENERAL_INFO01ACK: 0x29404f8, GENERAL_INFO01BRO: 0x29404fa,
  ASSISTREQ: 0x2940015,
  CONTROLLER_INFO00ACK: 0x1e942040, CONTROLLER_INFO00BRO: 0x1e942042,
  CONTROLLER_INFO02ACK: 0x1e942048, CONTROLLER_INFO02BRO: 0x1e94204a,
  CONTROLLER_INFO03ACK: 0x1e94204c, CONTROLLER_INFO03BRO: 0x1e94204e,
  BAT1_INFO01ACK: 0x1e942444, BAT1_INFO01BRO: 0x1e942446,
  BAT1_INFO06ACK: 0x1e942458, BAT1_INFO06BRO: 0x1e94245a,
  REARDERAILLEUR_INFO00ACK: 0x1e944840, REARDERAILLEUR_INFO00BRO: 0x1e944842,
  DERAILLEUR_STATE: 0x650, // 實測此車：後變速器狀態，data[0]=目前檔位(GearIndex)、data[4]=最大檔(GearRange)
  FRONTFORK_STATE: 0x294003c, // 前叉狀態：byte0=目前段(0x80最軟~0x85最硬、0xFF移動/歸零中)、byte1=狀態碼(0正常/1堵轉逾時/2歸零失敗/3尚未歸零)
};

// 來源優先序：GENERAL_INFO 一旦給過值就鎖定，忽略 DEVICE 來源的同名值（避免兩邊打架）。
const SRC = { NONE: 0, GENERAL: 1, DEVICE: 2 };

// ── 毫米波生理數據：走 CAN，不是 JSON ──────────────────────────
//   ID  = 0x1FA15000、DLC >= 2
//   d[0] = 心率 hr（bpm）、d[1] = 呼吸率 rr（brpm）
//   各自 0xFF = 該欄無效，兩個欄位獨立判斷（可能只有一個有效）
// 對照 BLE/ccpa_decode.js（ESP32 韌體）的 ID_MMWAVE_VITALS 處理。
// 不併進 snapshot()——生理量測在 App 走另一條 vitals 管線（與樹莓派 JSON 合流）。
export const MMWAVE_VITALS_ID = 0x1fa15000;

// 把 0x1FA15000 的 frame 解成 { hr, rr }（只回傳這包真的有效的欄位）。
// 不是這個 ID／DLC 不足／兩欄都無效 → 回 null。
export function parseMmwaveVitals(frame) {
  if (!frame || frame.id !== MMWAVE_VITALS_ID) return null;
  const d = frame.data || [];
  if (d.length < 2) return null;
  const out = {};
  if (d[0] !== 0xff) out.hr = d[0];
  if (d[1] !== 0xff) out.rr = d[1];
  return Object.keys(out).length ? out : null;
}

// ── 毫米波疲憊值 fi：另一個 CAN ID ────────────────────────────
//   ID  = 0x1FA15001、DLC >= 2
//   d[0..1] = fi × 100，uint16 LE（fi 為 0~100 的百分比）
//   0xFFFF = 無效
// 例：raw = 640 → fi = 6.4 %
export const MMWAVE_FI_ID = 0x1fa15001;

// 把 0x1FA15001 的 frame 解成 { fi }（百分比 0~100）。無效／不是這個 ID → 回 null。
export function parseMmwaveFi(frame) {
  if (!frame || frame.id !== MMWAVE_FI_ID) return null;
  const d = frame.data || [];
  if (d.length < 2) return null;
  const raw = d[0] | (d[1] << 8); // uint16 LE
  if (raw === 0xffff) return null; // 無效
  return { fi: raw / 100 };
}

const u16le = (d, i) => d[i] | (d[i + 1] << 8);
const u24le = (d, i) => d[i] | (d[i + 1] << 8) | (d[i + 2] << 16);
const tempC = (raw) => raw - 64;

export class CcpaDecoder {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      bikeSpeedValid: false, bikeSpeedKph: 0, bikeSpeedSource: SRC.NONE,
      cadenceValid: false, cadenceRpm: 0, cadenceSource: SRC.NONE,
      riderTorqueValid: false, riderTorqueNm: 0, riderTorqueSource: SRC.NONE,
      motorRpmValid: false, motorRpm: 0,
      motorTemperatureValid: false, motorTemperatureC: 0,
      assistLevelValid: false, assistLevel: 0,
      batterySocValid: false, batterySocPct: 0, batterySocSource: SRC.NONE,
      batteryVoltageValid: false, batteryVoltageMv: 0,
      batteryCurrentValid: false, batteryCurrentMa: 0,
      batteryTempsValid: [false, false, false, false], batteryTempsC: [0, 0, 0, 0],
      rearGearValid: false, rearGearIndex: 0, rearGearMax: 0, rearGearSource: SRC.NONE,
      forkValid: false, forkRaw: 0, forkStatus: 0,
    };
  }

  // 餵一行 "ID=.. DLC=.. DATA=.." 文字 → 解析 + 解封包（更新內部狀態）。
  // 回傳解出的 {id, dlc, data}，解析失敗回傳 null。
  feed(line) {
    const f = CcpaDecoder.parseRawLine(line);
    if (!f) return null;

    const s = this.state;
    const d = f.data;
    const dlc = d.length;

    switch (f.id) {
      case ID.GENERAL_INFO00ACK:
      case ID.GENERAL_INFO00BRO:
        if (dlc >= 6) {
          const sp = u16le(d, 0);
          // 實測：這台車 GENERAL_INFO00 的車速欄（byte0-1）永遠是 0，不是真的停。
          // 把 0 視同「這包沒車速」→ 不鎖定來源，讓 CONTROLLER_INFO00（0x1E942042）的
          // 真車速接手（撥輪子時它的 byte0-1 會跳非零）。等同下面扭力那行的 !==0x0000 處理。
          if (sp !== 0xffff && sp !== 0x0000) { s.bikeSpeedKph = sp * 0.01; s.bikeSpeedValid = true; s.bikeSpeedSource = SRC.GENERAL; }
          else if (sp === 0xffff) { s.bikeSpeedValid = false; s.bikeSpeedSource = SRC.NONE; }
          else { s.bikeSpeedSource = SRC.NONE; } // 0：不鎖定，交給 CONTROLLER_INFO00
          s.cadenceRpm = d[4]; s.cadenceValid = true; s.cadenceSource = SRC.GENERAL;
          const tq = u16le(d, 2);
          if (tq !== 0xffff && tq !== 0x0000) { s.riderTorqueNm = tq * 0.01; s.riderTorqueValid = true; s.riderTorqueSource = SRC.GENERAL; }
          else { s.riderTorqueValid = false; s.riderTorqueSource = SRC.NONE; }
          // ⚠️ 這裡「不」解助力段位。
          // 這台車不回報當下段位，GENERAL_INFO00 byte5 的助力欄不可靠；它又是定時廣播，
          // 會把使用者剛設的值一直沖掉（設 3 之後畫面被拉回舊值 → 看起來像改不動）。
          // 段位一律以「最後送出的指令」為準，只由 ASSISTREQ(0x2940015) 更新（見下面 case）。
        }
        break;

      // 助力段位的「唯一」來源：ASSISTREQ 指令封包（不論是手機送的還是 AI 板送的，
      // 都會出現在 bus 上）。這台車沒有定時廣播當下段位，所以畫面顯示的就是
      // 「最後一次送出的指令」——看到它變，代表指令確實上了 CAN。
      case ID.ASSISTREQ:
        if (dlc >= 2) {
          const l = d[1] & 0x0f;
          if (l <= 5) { s.assistLevel = l; s.assistLevelValid = true; }
          else if (l === 6) { s.assistLevelValid = false; }
        }
        break;

      case ID.GENERAL_INFO01ACK:
      case ID.GENERAL_INFO01BRO:
        if (dlc >= 5) {
          if (d[4] !== 0xff && d[4] !== 0x00) { s.batterySocPct = d[4]; s.batterySocValid = true; s.batterySocSource = SRC.GENERAL; }
          else { s.batterySocValid = false; s.batterySocSource = SRC.NONE; }
        }
        break;

      case ID.CONTROLLER_INFO00ACK:
      case ID.CONTROLLER_INFO00BRO:
        if (dlc >= 2 && s.bikeSpeedSource !== SRC.GENERAL) {
          const sp = u16le(d, 0);
          if (sp !== 0xffff) { s.bikeSpeedKph = sp * 0.01; s.bikeSpeedValid = true; s.bikeSpeedSource = SRC.DEVICE; }
        }
        break;

      case ID.CONTROLLER_INFO02ACK:
      case ID.CONTROLLER_INFO02BRO:
        if (dlc >= 7) {
          s.motorRpm = u16le(d, 4); s.motorRpmValid = true;
          // 實測這台車馬達溫度 byte（d[6]）永遠是 0（死欄位），tempC(0) = -64 是假值 → 當沒資料
          if (d[6] !== 0) { s.motorTemperatureC = tempC(d[6]); s.motorTemperatureValid = true; }
          else { s.motorTemperatureValid = false; }
        }
        break;

      case ID.CONTROLLER_INFO03ACK:
      case ID.CONTROLLER_INFO03BRO:
        if (dlc >= 4 && s.cadenceSource !== SRC.GENERAL) { s.cadenceRpm = d[3]; s.cadenceValid = true; s.cadenceSource = SRC.DEVICE; }
        if (dlc >= 6 && s.riderTorqueSource !== SRC.GENERAL) { s.riderTorqueNm = u16le(d, 4) * 0.1; s.riderTorqueValid = true; s.riderTorqueSource = SRC.DEVICE; }
        break;

      case ID.BAT1_INFO01ACK:
      case ID.BAT1_INFO01BRO:
        if (dlc >= 7) {
          s.batteryVoltageMv = u24le(d, 0); s.batteryVoltageValid = true;
          s.batteryCurrentMa = u16le(d, 4); s.batteryCurrentValid = true;
          if (s.batterySocSource !== SRC.GENERAL && d[6] !== 0xff) { s.batterySocPct = d[6]; s.batterySocValid = true; s.batterySocSource = SRC.DEVICE; }
        }
        break;

      case ID.BAT1_INFO06ACK:
      case ID.BAT1_INFO06BRO:
        if (dlc >= 4) {
          for (let i = 0; i < 4; i++) { s.batteryTempsC[i] = tempC(d[i]); s.batteryTempsValid[i] = true; }
        }
        break;

      case ID.REARDERAILLEUR_INFO00ACK:
      case ID.REARDERAILLEUR_INFO00BRO:
        if (dlc >= 2) { s.rearGearIndex = d[0]; s.rearGearMax = d[1]; s.rearGearValid = true; s.rearGearSource = SRC.DEVICE; }
        break;

      case ID.DERAILLEUR_STATE:
        // 新版 Derailleur State(Table 33)：byte0=GearIndex(目前檔位)、byte4=GearRange(最大檔位)。
        // 實測此車走這個 ID。byte4 有回報就用真車總檔數，沒有(dlc<5)才維持 0 → UI 用 SHIFT_FALLBACK_MAX。
        if (dlc >= 1) {
          s.rearGearIndex = d[0];
          if (dlc >= 5) s.rearGearMax = d[4];
          s.rearGearValid = true;
          s.rearGearSource = SRC.DEVICE;
        }
        break;

      case ID.FRONTFORK_STATE:
        // 前叉狀態：byte0=目前段(0x80~0x85；0xFF=移動中/歸零中)、byte1=狀態碼。
        if (dlc >= 2) { s.forkRaw = d[0]; s.forkStatus = d[1]; s.forkValid = true; }
        break;

      default:
        break; // 其他 ID（含 HMI_INFO00）目前不解析
    }
    return f;
  }

  // 乾淨快照：只給有效值，無效的給 null。適合直接丟給 UI 或轉 JSON。
  snapshot() {
    const s = this.state;
    return {
      speedKph: s.bikeSpeedValid ? s.bikeSpeedKph : null,
      cadenceRpm: s.cadenceValid ? s.cadenceRpm : null,
      torqueNm: s.riderTorqueValid ? s.riderTorqueNm : null,
      motorRpm: s.motorRpmValid ? s.motorRpm : null,
      motorTempC: s.motorTemperatureValid ? s.motorTemperatureC : null,
      assistLevel: s.assistLevelValid ? s.assistLevel : null,
      batterySocPct: s.batterySocValid ? s.batterySocPct : null,
      batteryVoltageMv: s.batteryVoltageValid ? s.batteryVoltageMv : null,
      batteryCurrentMa: s.batteryCurrentValid ? s.batteryCurrentMa : null,
      batteryTempsC: s.batteryTempsC.map((t, i) => (s.batteryTempsValid[i] ? t : null)),
      rearGear: s.rearGearValid ? { index: s.rearGearIndex, max: s.rearGearMax } : null,
      // 前叉：level=段位(0 最軟 0x80 ~ 5 最硬 0x85；移動中/未知為 null)、
      //       moving=移動/歸零中(0xFF)、status=狀態碼(0 正常/1 堵轉逾時/2 歸零失敗/3 尚未歸零)
      fork: s.forkValid
        ? {
            level: s.forkRaw >= 0x80 && s.forkRaw <= 0x85 ? s.forkRaw - 0x80 : null,
            moving: s.forkRaw === 0xff,
            status: s.forkStatus,
          }
        : null,
    };
  }

  // 把 "ID=0x01E942446 DLC=8 DATA=AA BB CC ..." 拆成 {id, dlc, data:[...]}。解不出回傳 null。
  static parseRawLine(line) {
    const m = /ID=0x([0-9A-Fa-f]+)\s+DLC=(\d+)\s+DATA=([0-9A-Fa-f ]*)/.exec(line);
    if (!m) return null;
    const id = parseInt(m[1], 16);
    const dlc = parseInt(m[2], 10);
    const bytes = m[3].trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));
    return { id, dlc, data: bytes.slice(0, dlc) };
  }
}
