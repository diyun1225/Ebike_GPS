# 部署到 GitHub Pages

## 一、在 GitHub 建一個空 repo
到 https://github.com/new → 取名（例如 `ebike-nav`）→ **不要**勾「Add README」→ Create。

## 二、把專案 push 上去
在終端機（路徑要在這個 `坡度路線規劃-react` 資料夾）：

```bash
cd /Users/lijiayun/豬隻規劃/坡度路線規劃-react

# 第一次用 git 才需要設定身份（已設過可略）
git config --global user.name "你的名字"
git config --global user.email "john22395214@gmail.com"

git init
git add .
git commit -m "init: e-bike 導航儀表板"
git branch -M main
git remote add origin https://github.com/你的帳號/你的repo.git
git push -u origin main
```

> `.gitignore` 已排除 `node_modules`、`dist`、`.env`，金鑰不會上傳。

## 三、設定金鑰 Secret
repo 頁面 → **Settings** → 左邊 **Secrets and variables → Actions** → **New repository secret**，新增兩筆：

| Name | Value |
|------|-------|
| `VITE_GOOGLE_MAPS_API_KEY` | 你的 Google Maps 金鑰 |
| `VITE_GOOGLE_MAPS_MAP_ID` | `434dbec01146b70a8769007e` |

## 四、開啟 GitHub Pages
repo → **Settings** → **Pages** → **Source** 選 **GitHub Actions**。

## 五、自動部署
做完上面，每次 `git push` 都會自動建置＋部署。
第一次 push 後到 **Actions** 分頁看綠勾，完成後網址是：

```
https://你的帳號.github.io/你的repo/
```

## 六、鎖金鑰（安全）
Google Cloud Console → 憑證 → 你的金鑰 → 應用程式限制 → 網站 → 加入：

```
https://你的帳號.github.io/*
```

之後手機隨時打開上面網址就能用，不用開電腦、不用通道。

## 之後要更新網站
改完程式後：

```bash
git add .
git commit -m "更新說明"
git push
```

push 完幾分鐘就自動更新上線。
