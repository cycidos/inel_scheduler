// ──────────────────────────────────────────────────────────────────
// scripts/build-edition.mjs
//
// IWS_EDITION 환경변수로 admin / editor / thumbnailer 빌드를 분기.
//
// 호출:
//   node scripts/build-edition.mjs                  # admin 기본
//   IWS_EDITION=editor node scripts/build-edition.mjs
//   IWS_EDITION=thumbnailer node scripts/build-edition.mjs
//
// 동작:
//   1) package.json 의 build 섹션을 기반으로 productName/appId/artifactName 등
//      을 edition 별 값으로 override 한 config 객체 생성.
//   2) electron-builder 의 Node API (build()) 로 Windows NSIS 빌드 실행.
//   3) NSIS 안의 ${PRODUCT_NAME} 매크로는 productName 을 그대로 받아쓰므로
//      설치 경로 / 레지스트리 / AppData 가 edition 별로 자연 분리됨.
//      (별도 installer.nsh 수정 불필요)
//
// 산출물:
//   release/<artifactName>.exe (+ .blockmap)
// ──────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import electronBuilder from "electron-builder";

const { build, Platform } = electronBuilder;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ── 유효성 검사 ──────────────────────────────────────────────────
const edition = process.env.IWS_EDITION || "admin";
const VALID_EDITIONS = ["admin", "editor", "thumbnailer"];
if (!VALID_EDITIONS.includes(edition)) {
  console.error(`[build-edition] invalid IWS_EDITION="${edition}". expected one of: ${VALID_EDITIONS.join(" | ")}`);
  process.exit(1);
}

// ── edition 별 분기 ─────────────────────────────────────────────
// productName: 폴더/레지스트리 이름으로 들어가므로 영문 + 공백만 사용 (안전)
// artifactName: 산출물 .exe 파일명. 외부 공유시 깨지지 않게 영문/ASCII 권장
// shortcutName: 시작메뉴 표시 이름. 한글 OK (Windows 가 처리)
const EDITION_CONFIG = {
  admin: {
    productName: "Inel Work Scheduler",
    appId: "com.inel.scheduler",
    artifactName: "Inel Work Scheduler-Setup-${version}.${ext}",
    shortcutName: "Inel Work Scheduler"
  },
  editor: {
    productName: "Inel Scheduler Editor",
    appId: "com.inel.scheduler.editor",
    artifactName: "Inel Scheduler-Editor-Setup-${version}.${ext}",
    shortcutName: "이늘 스케쥴러 (편집자)"
  },
  thumbnailer: {
    productName: "Inel Scheduler Thumbnailer",
    appId: "com.inel.scheduler.thumbnailer",
    artifactName: "Inel Scheduler-Thumbnailer-Setup-${version}.${ext}",
    shortcutName: "이늘 스케쥴러 (썸네일러)"
  }
};

const cfg = EDITION_CONFIG[edition];

// ── package.json 의 build 섹션을 기본으로 override ──────────────
const pkgRaw = readFileSync(path.join(projectRoot, "package.json"), "utf-8");
const pkg = JSON.parse(pkgRaw);
if (!pkg.build) {
  console.error("[build-edition] package.json 에 build 섹션이 없습니다.");
  process.exit(1);
}

// 출력 폴더는 기본 package.json 의 directories.output ("release") 를 따른다.
// 단, 보안 SW 가 .asar 를 잡고 있어 release 가 잠겨 풀리지 않을 때 우회를 위해
// IWS_OUTPUT_DIR 환경변수로 임시 폴더에 빌드할 수 있다.
const outputDir = process.env.IWS_OUTPUT_DIR || (pkg.build.directories && pkg.build.directories.output) || "release";

const builderConfig = {
  ...pkg.build,
  appId: cfg.appId,
  productName: cfg.productName,
  directories: {
    ...(pkg.build.directories || {}),
    output: outputDir
  },
  win: {
    ...pkg.build.win,
    artifactName: cfg.artifactName
  },
  nsis: {
    ...pkg.build.nsis,
    shortcutName: cfg.shortcutName
  }
};

// ── 실행 로그 ──────────────────────────────────────────────────
console.log("──────────────────────────────────────────");
console.log("[build-edition] start");
console.log(`  edition       : ${edition}`);
console.log(`  productName   : ${cfg.productName}`);
console.log(`  appId         : ${cfg.appId}`);
console.log(`  artifactName  : ${cfg.artifactName}`);
console.log(`  shortcutName  : ${cfg.shortcutName}`);
console.log(`  outputDir     : ${outputDir}`);
console.log("──────────────────────────────────────────");

// ── electron-builder 실행 ──────────────────────────────────────
try {
  const out = await build({
    targets: Platform.WINDOWS.createTarget(),
    config: builderConfig
  });
  console.log("[build-edition] done. artifacts:");
  for (const p of out) console.log(`  ${p}`);
} catch (err) {
  console.error("[build-edition] FAILED");
  console.error(err);
  process.exit(1);
}
