import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // 相對路徑，部署到 GitHub Pages 的子路徑也能正確載入資源
  base: "./",
  plugins: [react(), basicSsl()],
  server: {
    host: true, // 開放區網，手機可連
  },
});
