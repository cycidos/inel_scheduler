import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ────────────────────────────────────────────────────────────────────
// IWS_EDITION
//   "admin"       = 관리자(이늘) 풀 기능 빌드
//   "editor"      = 영상 편집자 전용
//   "thumbnailer" = 썸네일러 전용
//
// 빌드 시 환경변수 IWS_EDITION 로 결정. 미지정 시 "admin".
// `__IWS_EDITION__` 상수는 vite 의 define 으로 코드에 inline 치환되어
// Rollup tree-shaking 으로 다른 edition 의 코드 블록이 산출물에서 제거된다.
// ────────────────────────────────────────────────────────────────────
const EDITION = process.env.IWS_EDITION || "admin";
const VALID = ["admin", "editor", "thumbnailer"];
if (!VALID.includes(EDITION)) {
  throw new Error(`[vite] invalid IWS_EDITION="${EDITION}". expected one of ${VALID.join(" | ")}`);
}

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  },
  define: {
    __IWS_EDITION__: JSON.stringify(EDITION)
  }
});
