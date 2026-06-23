# electron/ — 메인 프로세스 컨벤션

## 파일
- `main.js` — 모든 비즈니스 로직, IPC 핸들러, 외부 API 호출. **단일 파일 유지**.
- `preload.js` — `contextBridge.exposeInMainWorld("electronAPI", ...)`. 노출만, 로직 금지.

## IPC 핸들러 추가 4단계 (필수)
1. **`main.js`** 에 `ipcMain.handle("<channel>", async (event, payload) => { ... })` 추가.
2. **`preload.js`** 에 `<methodName>: (args) => ipcRenderer.invoke("<channel>", payload)` 추가.
3. **`src/App.tsx`** 에서 `(window as any).electronAPI?.<methodName>(...)` 호출.
4. **`docs/structure/code_flow.md`** 에 신규/변경 항목 기록 (기존 dev-rule.mdc §1).

> 누락하면 dev 모드는 잠시 동작해도 **빌드 후 깨짐**. 특히 preload 는 hot-reload 안 되므로 변경 후 dev server 완전 재시작 필요.

## IPC 채널 네이밍
- 카테고리 prefix + `-` + 동사: `sheets-export`, `chzzk-start-polling`, `ai-list-models`.
- 이벤트 (main → renderer) 도 `chzzk-status` 처럼 같은 prefix 유지.
- 새 카테고리는 신중하게. 기존 prefix 재활용 우선.

## 외부 API 호출 규약
### Google Sheets (`googleapis`)
- 인증은 `google.auth.GoogleAuth` + Service Account JSON (`keyFile`).
- `valueInputOption`:
  - 일반 값 push → `USER_ENTERED` (날짜 자동 인식)
  - 헤더/메타 → `RAW`
- 헤더 정렬 보존이 핵심. `sheets-patch-row` 는 시트의 실제 헤더 순서를 읽고, 그 순서대로 데이터 배열을 만든다. 앱 schema 순서 강요 금지.

### Chzzk Open API
- 폴링 간격은 사용자 설정 (`pollingInterval`, ms 단위).
- `/service/v1/lives/...` (방송 상태), `/service/v1/search/lives` (카테고리 검색).
- `openDate` 를 초 단위로 KST 변환해서 `broadcastStartTime` 으로 사용.
- 응답 변화 감지는 `lastCategory` / `lastTitle` 비교 후 emit (중복 emit 방지).

## 에러 처리
- 사용자에게 보여야 하는 에러는 `webContents.send("chzzk-error", { message, stack })` 같은 이벤트로 전달.
- 핸들러 return 값은 `{ ok: boolean, data?, error? }` 형태 일관.
- `try { ... } catch (err) { return { ok: false, error: err.message } }` 패턴 권장.

## 시스템 / 파일시스템
- **유저 데이터**: `app.getPath('userData')` = `%APPDATA%\Inel Work Scheduler\`.
- 카테고리 사용자 추가분: `chzzk-categories-user.json` 한 파일에 누적.
- AI 모델 캐시: `ai-models-<provider>.json`.
- 자격증명: 사용자 입력한 SA JSON 은 `userData/google-credentials.json` 으로 복사 후 보관.

## NSIS / 인스톨러 인터페이스
- `customUnInstall` 매크로가 `%APPDATA%`, `%LOCALAPPDATA%-updater` 정리.
- 자동실행 설정은 임시 레지스트리 키 (`HKCU\Software\Inel Work Scheduler\PendingAutoStart`) → 첫 실행 시 `main.js` 가 읽고 `app.setLoginItemSettings()` 적용 후 키 삭제.
- 앱 삭제 (`app-uninstall` IPC): `spawn` 으로 `Uninstall Inel Work Scheduler.exe` `/S --force-run`, 600ms 후 `app.quit()`.

## 금지
- `nodeIntegration: true` 활성화 금지. 항상 preload + contextBridge.
- preload 안에 비즈니스 로직 작성 금지 (단순 invoke 노출만).
- IPC 핸들러 안에서 `setTimeout` 만으로 race condition 회피 → 가능하면 promise/queue 로 풀기.
- 동기 파일 IO (`fs.readFileSync`) 는 시작 시점에만. 핸들러 안에서는 `fs.promises.*` 사용.
