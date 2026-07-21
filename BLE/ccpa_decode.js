#include "ccpa_decode.h"
#include "control.h"   // control_get_assist_level():目前助力(指令值)

#include <string.h>

namespace
{
// CAN ID(對應 ccpa_decode.js / PROTOCOL.md)。同一筆常有 ACK / BRO 兩個 ID,內容相同。
enum : uint32_t
{
  ID_GENERAL_INFO00ACK = 0x29404FC, ID_GENERAL_INFO00BRO = 0x29404FE,
  ID_GENERAL_INFO01ACK = 0x29404F8, ID_GENERAL_INFO01BRO = 0x29404FA,
  ID_CONTROLLER_INFO00ACK = 0x1E942040, ID_CONTROLLER_INFO00BRO = 0x1E942042,
  ID_CONTROLLER_INFO03ACK = 0x1E94204C, ID_CONTROLLER_INFO03BRO = 0x1E94204E,
  ID_BAT1_INFO01ACK = 0x1E942444, ID_BAT1_INFO01BRO = 0x1E942446,
  ID_BAT1_INFO06ACK = 0x1E942458, ID_BAT1_INFO06BRO = 0x1E94245A,
  ID_ASSISTACK = 0x2940014,                // 助力回應:byte0 bit4-7 = Response Code(0=Success)
  // AI 板騎乘模式 ACK。實機(組員實測)= 0x1FA13001,DLC=2,d0=A5 d1=模式碼(例 A5 01/A5 02/A5 03)。
  // 文件版 0x1FA23000(d0=AA/EE d1=回音 d2=實際生效)實機沒在送,但保留一起收,兩種都認。
  ID_MMWAVE_VITALS = 0x1FA15000,           // 毫米波生理數據:d0=hr(bpm) d1=rr(brpm),0xFF=無效
  ID_SET_MODE_ACK_REAL = 0x1FA13001,       // 實機版:d0=A5, d1=模式碼
  ID_SET_MODE_ACK = 0x1FA23000,            // 文件版:d0=AA/EE d1=回音 d2=實際生效模式
  ID_FRONTFORK_STATE = 0x294003C,          // 讀回避震檔位:byte0=目前段(0x80軟~0x85硬/0xFF移動中) byte1=狀態碼
  ID_DERAILLEUR_STATE = 0x650,             // 新版:byte0=目前檔, byte4=最大檔
  ID_REARDERAILLEUR00ACK = 0x1E944840,     // 舊版:byte0=目前檔, byte1=最大檔(這台實測用這個)
  ID_REARDERAILLEUR00BRO = 0x1E944842,
};

// 來源優先序:GENERAL_INFO 一旦給過值就鎖定,忽略 DEVICE 來源的同名值(避免兩邊打架)。
enum Src { SRC_NONE = 0, SRC_GENERAL = 1, SRC_DEVICE = 2 };

inline uint16_t u16le(const uint8_t *d, int i) { return (uint16_t)(d[i] | (d[i + 1] << 8)); }
inline uint32_t u24le(const uint8_t *d, int i) { return (uint32_t)(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)); }
inline int tempC(uint8_t raw) { return (int)raw - 64; }

struct State
{
  bool bikeSpeedValid = false;      double bikeSpeedKph = 0;   int bikeSpeedSource = SRC_NONE;
  bool cadenceValid = false;        int cadenceRpm = 0;        int cadenceSource = SRC_NONE;
  bool riderTorqueValid = false;    double riderTorqueNm = 0;  int riderTorqueSource = SRC_NONE;
  bool batterySocValid = false;     int batterySocPct = 0;     int batterySocSource = SRC_NONE;
  bool batteryVoltageValid = false; uint32_t batteryVoltageMv = 0;
  bool batteryCurrentValid = false; uint16_t batteryCurrentMa = 0;
  bool batteryTempsValid[4] = {false, false, false, false};
  int  batteryTempsC[4] = {0, 0, 0, 0};
  bool rearGearValid = false;       int rearGearIndex = 0; int rearGearMax = 0;
  // 避震檔位讀回(0x294003C):level 1~5(byte0 0x81~0x85 → -0x80);moving=byte0 0xFF 移動中/未定位。
  bool frontForkValid = false;      int frontForkLevel = 0; bool frontForkMoving = false; int frontForkStatus = 0;
  // 毫米波生理數據(0x1FA15000):hr 心率 bpm / rr 呼吸率 brpm。0xFF = 該欄無效。
  bool heartRateValid = false;      int heartRateBpm = 0;
  bool respRateValid = false;       int respRateBpm = 0;
};

State g_s;
} // namespace

void ccpa_feed(uint32_t id, const uint8_t *d, uint8_t dlc)
{
  if (dlc > 8) dlc = 8;
  State &s = g_s;

  switch (id)
  {
    case ID_GENERAL_INFO00ACK:
    case ID_GENERAL_INFO00BRO:
      if (dlc >= 6)
      {
        // 這台車 GENERAL_INFO00 車速欄常年為 0(死欄位)→ 視同「這包沒車速」,不鎖定,
        // 讓 CONTROLLER_INFO00 的真車速接手。0xFFFF 才是明確無效。
        uint16_t sp = u16le(d, 0);
        if (sp != 0xFFFF && sp != 0x0000) { s.bikeSpeedKph = sp * 0.01; s.bikeSpeedValid = true; s.bikeSpeedSource = SRC_GENERAL; }
        else if (sp == 0xFFFF)            { s.bikeSpeedValid = false; s.bikeSpeedSource = SRC_NONE; }
        else                              { s.bikeSpeedSource = SRC_NONE; }
        s.cadenceRpm = d[4]; s.cadenceValid = true; s.cadenceSource = SRC_GENERAL;
        uint16_t tq = u16le(d, 2);
        if (tq != 0xFFFF && tq != 0x0000) { s.riderTorqueNm = tq * 0.01; s.riderTorqueValid = true; s.riderTorqueSource = SRC_GENERAL; }
        else                              { s.riderTorqueValid = false; s.riderTorqueSource = SRC_NONE; }
      }
      break;

    case ID_GENERAL_INFO01ACK:
    case ID_GENERAL_INFO01BRO:
      if (dlc >= 5)
      {
        if (d[4] != 0xFF && d[4] != 0x00) { s.batterySocPct = d[4]; s.batterySocValid = true; s.batterySocSource = SRC_GENERAL; }
        else                              { s.batterySocValid = false; s.batterySocSource = SRC_NONE; }
      }
      break;

    case ID_CONTROLLER_INFO00ACK:
    case ID_CONTROLLER_INFO00BRO:
      if (dlc >= 2 && s.bikeSpeedSource != SRC_GENERAL)
      {
        uint16_t sp = u16le(d, 0);
        if (sp != 0xFFFF) { s.bikeSpeedKph = sp * 0.01; s.bikeSpeedValid = true; s.bikeSpeedSource = SRC_DEVICE; }
      }
      break;

    case ID_CONTROLLER_INFO03ACK:
    case ID_CONTROLLER_INFO03BRO:
      if (dlc >= 4 && s.cadenceSource != SRC_GENERAL) { s.cadenceRpm = d[3]; s.cadenceValid = true; s.cadenceSource = SRC_DEVICE; }
      if (dlc >= 6 && s.riderTorqueSource != SRC_GENERAL) { s.riderTorqueNm = u16le(d, 4) * 0.1; s.riderTorqueValid = true; s.riderTorqueSource = SRC_DEVICE; }
      break;

    case ID_BAT1_INFO01ACK:
    case ID_BAT1_INFO01BRO:
      if (dlc >= 7)
      {
        s.batteryVoltageMv = u24le(d, 0); s.batteryVoltageValid = true;
        s.batteryCurrentMa = u16le(d, 4); s.batteryCurrentValid = true;
        if (s.batterySocSource != SRC_GENERAL && d[6] != 0xFF) { s.batterySocPct = d[6]; s.batterySocValid = true; s.batterySocSource = SRC_DEVICE; }
      }
      break;

    case ID_BAT1_INFO06ACK:
    case ID_BAT1_INFO06BRO:
      if (dlc >= 4)
      {
        for (int i = 0; i < 4; i++) { s.batteryTempsC[i] = tempC(d[i]); s.batteryTempsValid[i] = true; }
      }
      break;

    case ID_ASSISTACK: // 助力 ACK:Response Code(byte0 bit4-7)=0 → 車端採納 → 確認助力段位
      if (dlc >= 1) control_note_assist_ack(((d[0] >> 4) & 0x0F) == 0x00);
      break;

    case ID_MMWAVE_VITALS: // 毫米波生理數據:d0=hr d1=rr(各自 0xFF = 該欄無效,獨立判斷)
      if (dlc >= 2)
      {
        if (d[0] != 0xFF) { s.heartRateBpm = d[0]; s.heartRateValid = true; } else s.heartRateValid = false;
        if (d[1] != 0xFF) { s.respRateBpm  = d[1]; s.respRateValid  = true; } else s.respRateValid  = false;
      }
      break;

    case ID_SET_MODE_ACK_REAL: // 實機版:d0=A5 時 d1=模式碼 → 更新目前模式真值
      if (dlc >= 2 && d[0] == 0xA5) control_note_mode_ack(d[1]);
      break;

    case ID_SET_MODE_ACK: // 文件版:d0=AA 成功時 d2=實際生效模式 → 更新目前模式真值
      if (dlc >= 3 && d[0] == 0xAA) control_note_mode_ack(d[2]);
      break;

    case ID_FRONTFORK_STATE: // 避震檔位讀回:byte0=目前段(0x80~0x85) / 0xFF=移動中, byte1=狀態碼
      if (dlc >= 2)
      {
        if (d[0] == 0xFF) { s.frontForkMoving = true; s.frontForkValid = false; }        // 移動中/未定位 → 無有效檔位
        else if (d[0] >= 0x81 && d[0] <= 0x85) { s.frontForkLevel = d[0] - 0x80; s.frontForkValid = true; s.frontForkMoving = false; } // 0x81~0x85 → 檔位 1~5
        s.frontForkStatus = d[1]; // 0=正常 1=堵轉/逾時 2=歸零失敗 3=尚未歸零
      }
      break;

    case ID_DERAILLEUR_STATE: // 新版 0x650:byte0=目前檔, byte4=最大檔
      if (dlc >= 1) { s.rearGearIndex = d[0]; if (dlc >= 5) s.rearGearMax = d[4]; s.rearGearValid = true; }
      break;

    case ID_REARDERAILLEUR00ACK: // 舊版:byte0=目前檔, byte1=最大檔(這台實測用這個)
    case ID_REARDERAILLEUR00BRO:
      if (dlc >= 2) { s.rearGearIndex = d[0]; s.rearGearMax = d[1]; s.rearGearValid = true; }
      break;

    default:
      break;
  }
}

int ccpa_gear_index() { return g_s.rearGearValid ? g_s.rearGearIndex : -1; }
int ccpa_gear_max()   { return (g_s.rearGearValid && g_s.rearGearMax > 0) ? g_s.rearGearMax : -1; }

// 把數值欄位接上去:有效就印數字,無效印 null。
static int appendNum(char *buf, size_t buflen, int n, const char *key, bool valid, double val, int decimals)
{
  if (!valid)
    return snprintf(buf + n, buflen - n, "\"%s\":null,", key);
  return snprintf(buf + n, buflen - n, "\"%s\":%.*f,", key, decimals, val);
}

// 「car / 車輛」這一包(source:"can")。ESP 只送這包;IMU、心率(hr)是別的裝置的來源,不由 ESP 發。
// 欄位順序對應 t.txt 第一組。本機沒有的 slope_deg / battery_energy_consumed_wh 照樣給 null。
int ccpa_snapshot_json(char *buf, size_t buflen, int64_t timestampMs)
{
  const State &s = g_s;
  int n = 0;

  // source:讓後端辨別這是哪一包(can / imu / hr)。
  n += snprintf(buf + n, buflen - n, "{\"source\":\"can\",");

  // timestamp_ms:對到 NTP 才有值,否則 null。%lld 印 int64。
  if (timestampMs > 0) n += snprintf(buf + n, buflen - n, "\"timestamp_ms\":%lld,", (long long)timestampMs);
  else                 n += snprintf(buf + n, buflen - n, "\"timestamp_ms\":null,");

  // 這台車 CAN 解得出來的欄位。
  n += appendNum(buf, buflen, n, "speed_kph", s.bikeSpeedValid, s.bikeSpeedKph, 2);
  n += appendNum(buf, buflen, n, "cadence_rpm", s.cadenceValid, s.cadenceRpm, 0);
  n += appendNum(buf, buflen, n, "torque_nm", s.riderTorqueValid, s.riderTorqueNm, 2);

  // 坡度:本機無 IMU → null。
  n += snprintf(buf + n, buflen - n, "\"slope_deg\":null,");

  n += appendNum(buf, buflen, n, "battery_soc", s.batterySocValid, s.batterySocPct, 0);
  // 累積耗電量:未計算 → null。
  n += snprintf(buf + n, buflen - n, "\"battery_energy_consumed_wh\":null,");
  n += appendNum(buf, buflen, n, "battery_voltage_v", s.batteryVoltageValid, s.batteryVoltageMv / 1000.0, 2);
  n += appendNum(buf, buflen, n, "battery_current_a", s.batteryCurrentValid, s.batteryCurrentMa / 1000.0, 2);
  // 電池溫度:schema 只要一個值 → 取第一顆有效的感測器。
  {
    bool tv = false; int tc = 0;
    for (int i = 0; i < 4; i++) if (s.batteryTempsValid[i]) { tv = true; tc = s.batteryTempsC[i]; break; }
    n += appendNum(buf, buflen, n, "battery_temp_c", tv, tc, 0);
  }

  // 目前變速檔位(從 CAN 讀回:新版 0x650 / 舊版 0x1E944840)。
  // gear_max 不送:最大檔是已知規格(1~9),由下游程式自己判斷。
  n += appendNum(buf, buflen, n, "current_gear", s.rearGearValid, s.rearGearIndex, 0);

  // 目前輔助力檔位(0~5)。這台車無法從 CAN 讀回 → 取最後一次指令值;還沒設過 → null。
  {
    int a = control_get_assist_level();
    n += appendNum(buf, buflen, n, "assist_level", a >= 0, a, 0);
  }

  // 以下 4 個對應 ouo/v1/vehicle/state schema。
  // 目前騎乘模式(1 一般 / 2 電量管理 / 3 智慧輔助)= AI 板每秒廣播的實際生效值;沒收到 → null。
  {
    int m = control_get_mode();
    n += appendNum(buf, buflen, n, "control_mode", m >= 1, m, 0);
  }
  // 目前避震檔位:1~5(1=最軟 0x81 ... 5=最硬 0x85)。優先用 0x294003C 讀回的實際段位;
  // 還沒讀回或移動中(byte0=0xFF)就退回最後指令值,都沒有 → null。
  {
    int f = s.frontForkValid ? s.frontForkLevel : control_get_frontfork();
    n += appendNum(buf, buflen, n, "suspension_level", f >= 1, f, 0);
  }
  // 避震狀態碼(0x294003C byte1):0 正常 / 1 堵轉逾時 / 2 歸零失敗 / 3 尚未歸零;沒讀回 → null。
  // moving=true 代表正在移動/歸零(byte0=0xFF,檔位暫時無效)。
  {
    bool got = s.frontForkValid || s.frontForkMoving;
    n += appendNum(buf, buflen, n, "suspension_status", got, s.frontForkStatus, 0);
    n += snprintf(buf + n, buflen - n, "\"suspension_moving\":%s,", s.frontForkMoving ? "true" : "false");
  }
  // 座椅狀態:1=調整中(坐墊解鎖) / 2=鎖定。
  {
    int sl = control_get_seat_lock();
    n += appendNum(buf, buflen, n, "seat_lock", sl >= 1, sl, 0);
  }
  // 最後控制來源:0=Display(車表/本地) / 1=Service(後台 Web)。
  {
    int lc = control_get_last_controller();
    n += appendNum(buf, buflen, n, "last_controller", lc >= 0, lc, 0);
  }

  // 毫米波生理數據(CAN 0x1FA15000)。CAN 上沒收到過 → null。
  n += appendNum(buf, buflen, n, "hr", s.heartRateValid, s.heartRateBpm, 0);
  n += appendNum(buf, buflen, n, "rr", s.respRateValid,  s.respRateBpm,  0);

  // 收尾:上面最後一個欄位帶了逗號,這裡把 buf 尾端的逗號改成 '}'。
  if (n > 0 && n < (int)buflen && buf[n - 1] == ',') { buf[n - 1] = '}'; buf[n] = '\0'; }
  else n += snprintf(buf + n, buflen - n, "}");
  return n;
}
