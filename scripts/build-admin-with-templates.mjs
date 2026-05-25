// ──────────────────────────────────────────────────────────────────
// scripts/build-admin-with-templates.mjs
//
// 1.2.0+ 인스톨러 빌드 흐름:
//   admin 1.2.0 설치본의 [인스톨러 빌드] 버튼은 본인 PC 의 npm / electron-builder
//   환경에 의존해선 안 된다 (관리자도 어차피 설치본 사용). 그래서 admin 빌드 산출물
//   자체에 editor + thumbnailer 의 "template" .exe 를 동봉해두고, 관리자가 버튼을
//   누르면 main process 가 template 을 복사하고 옆에 inel-staff-config.json 만
//   생성하는 구조로 전환했다.
//
// 이 스크립트가 그 orchestration 을 담당:
//   1) editor template 빌드     → release/templates/Inel Scheduler-Editor-Setup-X.Y.Z.exe
//   2) thumbnailer template 빌드 → release/templates/Inel Scheduler-Thumbnailer-Setup-X.Y.Z.exe
//   3) build/installer-templates/ 로 복사 (electron-builder 가 extraResources 로 읽음)
//   4) admin 빌드 → release/Inel Work Scheduler-Setup-X.Y.Z.exe
//      (이 안에 위 두 template .exe 가 동봉됨)
//
// 호출:
//   node scripts/build-admin-with-templates.mjs
// 또는 npm:
//   npm run dist                 ← admin only (template 없이, 빠른 dev 테스트용)
//   npm run dist:full             ← 본 스크립트 호출 (template 포함, 배포용)
// ──────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const templateDir = path.join(projectRoot, "build", "installer-templates");

function log(msg) {
  console.log(`[full-build] ${msg}`);
}

function fail(msg) {
  console.error(`[full-build] FAILED — ${msg}`);
  process.exit(1);
}

function run(cmd, args, env) {
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: useShell,
    env: { ...process.env, ...(env || {}) }
  });
  if (result.status !== 0) {
    fail(`command exited with ${result.status}: ${cmd} ${args.join(" ")}`);
  }
}

// ── 1) build/installer-templates/ 초기화 ─────────────────────────
if (existsSync(templateDir)) {
  log(`cleaning ${templateDir}`);
  rmSync(templateDir, { recursive: true, force: true });
}
mkdirSync(templateDir, { recursive: true });

// release/ 에 같은 prefix 의 옛 산출물이 남아 있으면 새 빌드와 혼동되므로 미리 정리.
function purgeReleaseByPrefix(prefix) {
  if (!existsSync(releaseDir)) return;
  for (const f of readdirSync(releaseDir)) {
    if (f.startsWith(prefix)) {
      const target = path.join(releaseDir, f);
      try { rmSync(target, { force: true }); log(`  purged ${f}`); }
      catch (_e) { /* ignore */ }
    }
  }
}

// ── 2) editor template 빌드 ─────────────────────────────────────
log("step 1/3 — building editor template ...");
purgeReleaseByPrefix("Inel Scheduler-Editor-Setup");
run("npm", ["run", "dist:editor"]);

let editorExe = null;
for (const f of readdirSync(releaseDir)) {
  if (f.startsWith("Inel Scheduler-Editor-Setup") && f.endsWith(".exe")) {
    editorExe = f;
    break;
  }
}
if (!editorExe) fail("editor template .exe not found in release/");
log(`  copying ${editorExe} → build/installer-templates/`);
copyFileSync(path.join(releaseDir, editorExe), path.join(templateDir, editorExe));

// ── 3) thumbnailer template 빌드 ─────────────────────────────────
log("step 2/3 — building thumbnailer template ...");
purgeReleaseByPrefix("Inel Scheduler-Thumbnailer-Setup");
run("npm", ["run", "dist:thumbnailer"]);

let thumbExe = null;
for (const f of readdirSync(releaseDir)) {
  if (f.startsWith("Inel Scheduler-Thumbnailer-Setup") && f.endsWith(".exe")) {
    thumbExe = f;
    break;
  }
}
if (!thumbExe) fail("thumbnailer template .exe not found in release/");
log(`  copying ${thumbExe} → build/installer-templates/`);
copyFileSync(path.join(releaseDir, thumbExe), path.join(templateDir, thumbExe));

// ── 4) admin 빌드 (template 동봉) ────────────────────────────────
log("step 3/3 — building admin with templates embedded ...");
run("npm", ["run", "dist:admin"]);

log("done.");
log(`  admin installer    : release/Inel Work Scheduler-Setup-*.exe`);
log(`  staff templates    : embedded inside admin (Resources/installer-templates/)`);
