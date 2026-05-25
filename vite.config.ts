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
//   IWS_NAME       편집자/썸네일러 이름. 시트의 담당자 셀 매칭용 표시명
//   IWS_EMAIL      편집자/썸네일러 Google 계정 이메일. 본인 OAuth 로그인 시 일치 검증 + 시트 공유 권한 매칭
//   IWS_ROLE       "editor" | "thumbnailer"
//   IWS_SHEET_URL  연결할 Google Sheet URL
//
// 1.2.0 — OAuth 전환 후 IWS_TOKEN / IWS_SA_KEY_B64 제거. 스태프 앱은 본인 Google
// 계정으로 직접 로그인 → 시트 공유 권한이 진실의 단일 소스.
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
  email: IS_ADMIN ? "" : (process.env.IWS_EMAIL || ""),
  role: IS_ADMIN ? "" : (process.env.IWS_ROLE || EDITION),
  sheetUrl: IS_ADMIN ? "" : (process.env.IWS_SHEET_URL || "")
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
    __IWS_EMAIL__: JSON.stringify(EMBED.email),
    __IWS_ROLE__: JSON.stringify(EMBED.role),
    __IWS_SHEET_URL__: JSON.stringify(EMBED.sheetUrl)
  }
});
