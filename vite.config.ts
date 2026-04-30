import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // file:// 프로토콜로 로드되는 Electron 패키지 빌드를 위해 상대 경로로 출력.
  // (절대 '/' 였을 경우 file:///assets/... 로 해석되어 화면이 흰색으로 뜸)
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  }
});
