# build/ — electron-builder 리소스 + NSIS 커스텀 매크로

## 파일
- `icon.png` — 인스톨러/앱 아이콘. 256x256 권장.
- `installer.nsh` — NSIS 커스텀 매크로 (electron-builder 가 hook 처리).

## NSIS 매크로 구조
electron-builder 가 다음 매크로를 자동으로 찾아 호출:

| 매크로 | 호출 시점 | 우리 사용 |
|---|---|---|
| `!macro preInit` | 디렉토리 확정 직전 | 기본 경로를 `$DOCUMENTS\${PRODUCT_NAME}` 로 강제 |
| `!macro customPageAfterChangeDir` | "설치 위치" 다음 페이지 | 옵션 체크박스 페이지 추가 |
| `!macro customInstall` | 설치 작업 본체 | 바로가기 + `PendingAutoStart` 레지스트리 |
| `!macro customUnInstall` | 언인스톨 | 모든 흔적 정리 |

## NSIS 컴파일 함정 (꼭 알아둘 것)
NSIS 는 **installer 와 uninstaller 를 별도 컴파일**합니다. installer 전용 변수/함수 (`Var $X`, `Function FooPage`, page custom) 가 uninstaller 빌드에도 보이면 다음 경고가 나옵니다:

```
warning 6010: install function "FooPage" not referenced - no Section calls it
```

electron-builder 는 이 경고를 **에러로 취급**하므로, installer 전용 코드는 반드시 다음 가드 안에:

```nsis
!ifndef BUILD_UNINSTALLER
  Var ...
  Function ...
  !macro customInstall ... !macroend
!endif
```

`customUnInstall` 만 `!ifndef` 밖에 둡니다.

## 자동실행 (Auto-start) 핸드오프
- NSIS 가 `Run` 레지스트리를 직접 쓰지 않습니다. → Electron 의 `getLoginItemSettings` 가 ON 으로 인식하지 못함 (Electron 만의 인용/args 포맷 필요).
- 대신 NSIS 는 `HKCU\Software\Inel Work Scheduler\PendingAutoStart` 에 `"1"` / `"0"` 만 적습니다.
- `electron/main.js` 의 첫 실행 코드가 그 값을 읽어 `app.setLoginItemSettings({ openAtLogin: ... })` 호출 후 키를 삭제합니다.
- 둘 중 한 쪽만 고치지 마세요. 양쪽 동기화 필수.

## 언인스톨 시 정리 항목
`customUnInstall` 매크로가 정리하는 것:

1. `$DESKTOP\${PRODUCT_NAME}.lnk` — 바탕화면 바로가기
2. `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\${PRODUCT_NAME}` — 자동실행 키
3. `HKCU\Software\${PRODUCT_NAME}` — 우리 앱 레지스트리
4. `$APPDATA\${PRODUCT_NAME}` — 유저 데이터 (`app.getPath('userData')`)
5. `$LOCALAPPDATA\${PRODUCT_NAME}` — Chromium 캐시
6. `$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater` — electron-builder 자동 업데이트 캐시
7. `$INSTDIR` — 비어있으면 폴더 자체 삭제 (사용자 추가 파일 있으면 NSIS 가 알아서 보존)

`deleteAppDataOnUninstall: true` 만으로는 Chromium 캐시가 남는 경우가 있어 RMDir로 안전망 한 번 더.

## 빌드 실행
```bash
npm run dist
```

산출물: `release/Inel Work Scheduler-Setup-<version>.exe` + `.blockmap`

빌드 실패 흔한 원인:
- **"Can't open output file"** — 같은 이름의 exe 가 IDE/탐색기에서 열려 잠겨 있음. `Remove-Item -Force release\*.exe` 후 재시도.
- **"winCodeSign 심볼릭 링크"** — Windows 에서 symlink 권한 부족. 관리자 PowerShell 또는 개발자 모드 켜기.
- **"warning 6010" 가 error 가 됨** — `!ifndef BUILD_UNINSTALLER` 가드 누락. 위 섹션 참조.
- **`Cannot find module './docs'`** — `package.json` `build.files` 에서 googleapis 내부 모듈 누락. `!docs/**` 같은 광역 exclude 패턴 다듬기.

## 업그레이드 정책
- **`electron-updater` 미사용**. 수동 배포 + NSIS overwrite.
- 같은 `appId` 의 새 버전 인스톨러를 실행하면 NSIS 가 자동으로 silent uninstall → install 흐름.
- 유저 데이터 (`$APPDATA`) 는 보존됨 (관리자가 v1.0.0 → v1.0.1 테스트로 검증 완료).
- 단, **앱을 완전히 종료한 상태에서만** 업그레이드 가능. 실행 중이면 NSIS 가 멈춤.

## 코드사인
- 현재 미서명 (`no signing info identified, signing is skipped`).
- 사용자 PC 의 SmartScreen 이 매번 경고 띄움. 정식 배포 전 코드사인 인증서 도입 검토 항목.
- 인증서 도입 시 `cscLink` + `cscKeyPassword` 환경변수로. **절대 `package.json` 에 평문 적지 말 것**.
