import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import obfuscator from "vite-plugin-javascript-obfuscator";

// ────────────────────────────────────────────────────────────────────
// IWS_EDITION
//   "admin"       = 관리자(이늘) 풀 기능 빌드
//   "editor"      = 영상 편집자 전용
//   "thumbnailer" = 썸네일러 전용
//
// 빌드 시 환경변수 IWS_EDITION 로 결정. 미지정 시 "admin".
// `__IWS_EDITION__` 상수는 vite 의 define 으로 코드에 inline 치환되어
// Rollup tree-shaking 으로 다른 edition 의 코드 블록이 산출물에서 제거된다.
//
// 추가 메타데이터(편집자 인스톨러 한정, admin 빌드에는 모두 빈 문자열):
//   IWS_NAME       편집자/썸네일러 이름. 임베드 시 자동 본인 식별
//   IWS_ROLE       "editor" | "thumbnailer" (UI 분기 외 _tokens 매칭에 사용)
//   IWS_TOKEN      32-48 hex 토큰. _tokens 시트와 대조
//   IWS_SHEET_URL  연결할 Google Sheet URL
//   IWS_SA_KEY_B64 Service Account JSON 의 base64. 첫 실행 시 main 이 userData 에 풀어 저장
// ────────────────────────────────────────────────────────────────────
const EDITION = process.env.IWS_EDITION || "admin";
const VALID = ["admin", "editor", "thumbnailer"];
if (!VALID.includes(EDITION)) {
  throw new Error(`[vite] invalid IWS_EDITION="${EDITION}". expected one of ${VALID.join(" | ")}`);
}

// admin 빌드에서는 모든 임베드 메타가 빈 문자열이어야 한다 (관리자 본인이 셋업).
const IS_ADMIN = EDITION === "admin";
const EMBED = {
  name: IS_ADMIN ? "" : (process.env.IWS_NAME || ""),
  role: IS_ADMIN ? "" : (process.env.IWS_ROLE || EDITION),
  token: IS_ADMIN ? "" : (process.env.IWS_TOKEN || ""),
  sheetUrl: IS_ADMIN ? "" : (process.env.IWS_SHEET_URL || ""),
  saKeyB64: IS_ADMIN ? "" : (process.env.IWS_SA_KEY_B64 || "")
};

// staff 빌드에 한해 경량 난독화 적용 (Lv.1 — 호기심 추출 차단 수준).
// admin 빌드 / dev 모드는 일체 적용 안 함 (디버깅 가능성 유지).
const plugins: PluginOption[] = [react()];
if (!IS_ADMIN) {
  plugins.push(
    obfuscator({
      apply: "build",
      options: {
        compact: true,
        controlFlowFlattening: false, // 무거움. 끔.
        deadCodeInjection: false,
        debugProtection: false,
        identifierNamesGenerator: "mangled",
        renameGlobals: false,
        selfDefending: false,
        stringArray: true,
        stringArrayEncoding: ["base64"], // sa key 가 grep 으로 안 잡히도록
        stringArrayThreshold: 0.75,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
        target: "browser"
      }
    })
  );
}

export default defineConfig({
  base: "./",
  plugins,
  server: {
    port: 5173,
    strictPort: true
  },
  define: {
    __IWS_EDITION__: JSON.stringify(EDITION),
    __IWS_NAME__: JSON.stringify(EMBED.name),
    __IWS_ROLE__: JSON.stringify(EMBED.role),
    __IWS_TOKEN__: JSON.stringify(EMBED.token),
    __IWS_SHEET_URL__: JSON.stringify(EMBED.sheetUrl),
    __IWS_SA_KEY_B64__: JSON.stringify(EMBED.saKeyB64)
  }
});
