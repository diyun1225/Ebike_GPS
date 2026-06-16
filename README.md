# 路線坡度規劃 (React)

用 **React + Vite** 寫的版本。輸入起始地與目的地，畫出路線，把路線切成多段並計算每段坡度。

使用 Google Maps：Directions API（路線）、Elevation API（高度/坡度）、Maps JavaScript API（地圖）、Places（地點自動完成）。

## 安裝與執行

```bash
cd 坡度路線規劃-react

# 1. 安裝套件
npm install

# 2. 設定 API 金鑰
cp .env.example .env
# 然後編輯 .env，把 YOUR_API_KEY 換成你的金鑰

# 3. 啟動開發伺服器
npm run dev
```

啟動後瀏覽器開 http://localhost:5173

## 取得 API 金鑰

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案。
2. 啟用：Maps JavaScript API、Directions API、Elevation API、Places API。
3. 建立 API 金鑰，填入 `.env` 的 `VITE_GOOGLE_MAPS_API_KEY`。

## 專案結構

```
src/
├── main.jsx              進入點
├── App.jsx               主元件，管理地圖與路線狀態
├── useGoogleMaps.js      載入 Google Maps script 的 hook
├── slope.js             坡度計算與顏色工具
├── index.css            樣式
└── components/
    ├── Sidebar.jsx       左側輸入表單與摘要
    └── SegmentList.jsx   每段坡度列表
```

## 坡度顏色對照

| 顏色 | 坡度 |
|------|------|
| 🔵 深藍 | 下坡 (≤ -3%) |
| 🟢 綠 | 平緩 (-3% ~ 1%) |
| 🟩 淺綠 | 微上坡 (1% ~ 4%) |
| 🟡 黃 | 中等 (4% ~ 7%) |
| 🟠 橘 | 陡 (7% ~ 10%) |
| 🔴 紅 | 很陡 (10% ~ 13%) |
| 🟣 紫 | 超陡 (≥ 13%) |

## 計算說明

- 沿路線等距取樣 512 個高度點。
- 依分段數平均切段，每段坡度 =（該段高度變化 ÷ 水平距離）× 100%。
- 同時統計每段累計爬升 / 下降。
