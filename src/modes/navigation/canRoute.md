# 電量管理模式 — 路段坡度 CAN 協定

導航把路線依坡度切成路段後，透過 BLE 送 `CAN,<id>,<dlc>,<byte0>,...`（16 進位、newline 結尾）給 AI 板，
由 AI 板轉成實體 CAN 幀。所有多位元組欄位皆為 **小端 (LE)**。

程式：[`canRoute.js`](./canRoute.js)

## 訊息

| 名稱 | CAN ID | DLC | 何時送 |
|---|---|---|---|
| ROUTE_HDR 路線表頭 | `0x1FA14000` | 5 | 進入導航時送一次 |
| ROUTE_SEG 路段資料 | `0x1FA14001` | 7 | 開始導航先上傳每一段；行進中每換一段送目前段，並每 1 秒重送目前段（讓運算板中途連上也能同步） |

## ROUTE_HDR (0x1FA14000) — 5 bytes

| byte | 欄位 | 型別 | 解碼 |
|---|---|---|---|
| 0–1 | route_id | uint16 LE | 路線識別碼（`null` → 0；字串以 FNV-1a 16-bit 雜湊） |
| 2 | segment_count | uint8 | 路段總數 |
| 3–4 | total_distance_m | uint16 LE | 總距離，公尺 |

## ROUTE_SEG (0x1FA14001) — 7 bytes

| byte | 欄位 | 型別 | 解碼 |
|---|---|---|---|
| 0 | segment_index | uint8 | 路段序號（`0xFF` = null） |
| 1–2 | segment_distance_m | uint16 LE | 路段距離，公尺 |
| 3–4 | grade_pct | int16 LE | 坡度%，**÷100**（0.01% 解析） |
| 5–6 | elevation_delta_m | int16 LE | 高度變化 m，**÷10**（0.1m 解析） |

## 解碼範例

`CAN,1FA14001,7,03,20,03,F4,01,20,03`

```
b0        = 0x03           → segment_index   = 3
b1..2 LE  = 0x0320 = 800   → segment_distance = 800 m
b3..4 LE  = 0x01F4 = 500   → grade_pct        = 500 / 100 = 5.00 %
b5..6 LE  = 0x0320 = 800   → elevation_delta  = 800 / 10  = 80.0 m
```

int16 為二補數：讀出 ≥ 0x8000 時減 0x10000（例：下坡 -3.2% 送 `0xFF60` = -160 → -1.60%… 依實際值）。
