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
// 1.2.0+ — 스태프 본인 정보 (name / email / role / sheetUrl) 는 더 이상 빌드
// 시점에 vite define 으로 박지 않는다. 런타임에 main process 가 사이드카
// inel-staff-config.json 을 읽어 IPC 로 renderer 에 전달.
// → editor / thumbnailer 인스톨러를 사전 빌드 (template) 만 해두고, 관리자가
//    설치본의 [인스톨러 빌드] 버튼으로 사이드카 .json 만 생성하면 끝나는 구조.
// ────────────────────────────────────────────────────────────────────
const EDITION = process.env.IWS_EDITION || "admin";
const VALID = ["admin", "editor", "thumbnailer"];
if (!VALID.includes(EDITION)) {
  throw new Error(`[vite] invalid IWS_EDITION="${EDITION}". expected one of ${VALID.join(" | ")}`);
}

const IS_ADMIN = EDITION === "admin";

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
    __IWS_EDITION__: JSON.stringify(EDITION)
  }
});
