// 把輔助力段數打包成 ASSISTREQ CAN 封包
//   ID  = 0x2940015（延伸 29-bit，對應 BLE/ccpa_decode.js 的 ASSISTREQ）
//   DLC = 2
//   DATA = [0x02, 段位]
// 回傳 { id, dlc, data, tx }，tx 是送給板子的字串格式：CAN,<id>,<dlc>,<byte0>,<byte1>
//   例：段位 3 → "CAN,2940015,2,02,03"
export const ASSISTREQ_ID = 0x2940015;

const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

export function gearToAssistFrame(gear) {
  const data = [0x02, gear & 0xff];
  return {
    id: ASSISTREQ_ID,
    dlc: 2,
    data,
    tx: `CAN,${ASSISTREQ_ID.toString(16).toUpperCase()},2,${data
      .map(hex2)
      .join(",")}`,
  };
}
