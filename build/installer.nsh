; ───────────────────────────────────────────────────────────────
; Inel Work Scheduler - NSIS 커스텀 스크립트
; electron-builder의 installer.nsh hook
;
; 목표:
;   1) 기본 설치 경로를 "내 문서\Inel Work Scheduler" 로 설정
;   2) 디렉토리 선택 페이지 다음에 옵션 페이지 추가
;        - 바탕화면 바로가기 만들기 (기본 체크)
;        - 윈도우 시작 시 자동 실행      (기본 체크)
;   3) 선택값에 따라 바로가기 / Run 레지스트리 등록
;   4) 언인스톨 시 위 항목들 함께 정리
;
; NSIS 빌드는 installer 와 uninstaller 를 각각 컴파일하므로
; install 전용 변수/함수는 !ifndef BUILD_UNINSTALLER 로 감싸야
; "warning 6010: install function ... not referenced" 가 안 난다.
; ───────────────────────────────────────────────────────────────

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; ───────────────────────────────────────────────────────────────
; preInit:
;   electron-builder가 $INSTDIR 을 확정하기 직전에 호출.
;   기본 설치 경로를 "내 문서\Inel Work Scheduler" 로 강제 지정.
; ───────────────────────────────────────────────────────────────
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$DOCUMENTS\${PRODUCT_NAME}"
  StrCpy $INSTDIR "$DOCUMENTS\${PRODUCT_NAME}"
!macroend

; ───────────────────────────────────────────────────────────────
; customInit:
;   electron-builder가 옛 버전을 silent uninstall 호출하기 *직전* 시점.
;   여기서 옛 1.x.x 의 $APPDATA\${PRODUCT_NAME} 을 임시 폴더로 Rename 해두면
;   옛 customUnInstall 매크로의 RMDir 가 빈 폴더만 발견하여 noop 이 된다.
;   설치 완료 시점 customInstall 에서 다시 원위치로 Rename 하여 복원.
;
;   Rename 은 메타데이터만 변경하므로 즉시 끝나고, Chromium 캐시가 잠겨
;   있어도 폴더 단위 이동이라 영향을 받지 않는다 (파일 핸들이 아니라
;   디렉토리 엔트리만 변경).
;
;   $InelUpgradeFound 가 1 이면 "기존 버전을 발견했다" 라는 안내를
;   추가 페이지로 표시한다.
; ───────────────────────────────────────────────────────────────
!ifndef BUILD_UNINSTALLER

Var InelOptDialog
Var InelDesktopShortcutCheckbox
Var InelDesktopShortcutState
Var InelAutoStartCheckbox
Var InelAutoStartState
Var InelUpgradeFound
Var InelUpgradeDialog

!macro customInit
  ; 옛 1.x.x 의 AppData 가 있으면 (= 업그레이드 케이스)
  IfFileExists "$APPDATA\${PRODUCT_NAME}\*.*" 0 noOldData
    ; 이미 backup 폴더가 잔존하면 (이전 실패 흔적) 먼저 정리
    IfFileExists "$APPDATA\${PRODUCT_NAME}.upgrade-backup\*.*" 0 +2
      RMDir /r "$APPDATA\${PRODUCT_NAME}.upgrade-backup"
    ; Rename — 디렉토리 엔트리만 변경, 파일 IO 없음
    Rename "$APPDATA\${PRODUCT_NAME}" "$APPDATA\${PRODUCT_NAME}.upgrade-backup"
    StrCpy $InelUpgradeFound "1"
    Goto initDone
  noOldData:
    StrCpy $InelUpgradeFound "0"
  initDone:
!macroend

!macro customPageAfterChangeDir
  Page custom InelUpgradePageCreate InelUpgradePageLeave
  Page custom InelOptionsPageCreate InelOptionsPageLeave
!macroend

; ───── 업그레이드 안내 페이지 (옛 데이터 발견 시에만 노출) ─────
Function InelUpgradePageCreate
  ${If} $InelUpgradeFound != "1"
    Abort  ; 옛 데이터 없으면 페이지 자체 skip
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "업데이트로 진행" "기존 버전이 발견되었습니다."

  nsDialogs::Create 1018
  Pop $InelUpgradeDialog
  ${If} $InelUpgradeDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 16u "기존 ${PRODUCT_NAME} 설치를 발견했습니다."
  ${NSD_CreateLabel} 0 20u 100% 48u "업데이트 모드로 진행됩니다:$\r$\n  · 작업 데이터 / 시트 링크 / 편집자 명단 / 설정값은 모두 그대로 보존$\r$\n  · 앱 파일만 새 버전으로 교체$\r$\n  · 자동실행 / 바로가기 / 인증 정보도 유지"
  ${NSD_CreateLabel} 0 78u 100% 16u "[다음] 버튼을 눌러 진행하세요."

  nsDialogs::Show
FunctionEnd

Function InelUpgradePageLeave
  ; 사용자 선택값 없음 — 안내 페이지일 뿐
FunctionEnd

Function InelOptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "추가 옵션" "설치 후 동작을 선택하세요."

  nsDialogs::Create 1018
  Pop $InelOptDialog

  ${If} $InelOptDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "설치 후 자동으로 적용할 항목을 체크하세요. 나중에 앱의 [기타 설정] 탭에서도 변경할 수 있습니다."

  ${NSD_CreateCheckbox} 0 32u 100% 12u "바탕화면 바로가기 만들기"
  Pop $InelDesktopShortcutCheckbox
  ${NSD_Check} $InelDesktopShortcutCheckbox

  ${NSD_CreateCheckbox} 0 50u 100% 12u "윈도우 시작 시 자동 실행"
  Pop $InelAutoStartCheckbox
  ${NSD_Check} $InelAutoStartCheckbox

  nsDialogs::Show
FunctionEnd

Function InelOptionsPageLeave
  ${NSD_GetState} $InelDesktopShortcutCheckbox $InelDesktopShortcutState
  ${NSD_GetState} $InelAutoStartCheckbox $InelAutoStartState
FunctionEnd

!macro customInstall
  ; ── 업그레이드 백업 복원 (customInit 의 Rename 대응) ──
  ;
  ; 옛 silent uninstall 흐름은 이 시점까지 끝나 있다. customInit 에서
  ; .upgrade-backup 로 옮겨둔 폴더가 있으면 다시 원위치로 Rename.
  ;
  ; 만약 silent uninstall 의 RMDir 가 운 좋게 (혹은 운 나쁘게) $APPDATA\PRODUCT_NAME
  ; 빈 폴더를 어떻게든 새로 만들었다면 그것부터 정리 후 Rename.
  IfFileExists "$APPDATA\${PRODUCT_NAME}.upgrade-backup\*.*" 0 noRestore
    IfFileExists "$APPDATA\${PRODUCT_NAME}\*.*" 0 doRestore
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
    doRestore:
      Rename "$APPDATA\${PRODUCT_NAME}.upgrade-backup" "$APPDATA\${PRODUCT_NAME}"
      DetailPrint "Restored user data from upgrade backup"
  noRestore:

  ; ── 스태프 인스톨러 사이드카 흡수 (1.2.0+ 인스톨러 빌드 흐름) ──
  ;
  ; 관리자가 admin 앱의 [인스톨러 빌드] 로 만든 두 파일:
  ;   1) Inel Scheduler-Editor-Setup-X.Y.Z.exe
  ;   2) inel-staff-config.json
  ; 이 같은 폴더에 있는 채로 .exe 가 실행되면, $EXEDIR 의 .json 을 설치 폴더로
  ; 복사한다. 앱 첫 실행 시 main.js 가 그 .json 을 userData/embed.json 으로
  ; 흡수하고 설치 폴더의 .json 은 정리한다.
  IfFileExists "$EXEDIR\inel-staff-config.json" 0 noStaffSidecar
    CopyFiles /SILENT "$EXEDIR\inel-staff-config.json" "$INSTDIR\inel-staff-config.json"
    DetailPrint "Staff sidecar config copied to install dir"
  noStaffSidecar:

  ${If} $InelDesktopShortcutState == ${BST_CHECKED}
    ; 아이콘 명시 — staff 빌드의 시작메뉴/바탕화면 단축키도 본체 .exe 안의 아이콘 사용.
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ; 자동실행은 Electron 이 자기 표준 형식(따옴표/args 포함)으로 등록해야
  ; getLoginItemSettings 가 정확히 ON 으로 인식한다.
  ; 따라서 여기서는 Run 키를 직접 만지지 않고, 사용자 의도만
  ; HKCU\Software\Inel Work Scheduler 의 PendingAutoStart 값에 적어둔다.
  ; 앱이 첫 실행될 때 main.js 가 이 값을 읽어 app.setLoginItemSettings 호출 후 키를 지운다.
  ${If} $InelAutoStartState == ${BST_CHECKED}
    WriteRegStr HKCU "Software\${PRODUCT_NAME}" "PendingAutoStart" "1"
  ${Else}
    WriteRegStr HKCU "Software\${PRODUCT_NAME}" "PendingAutoStart" "0"
  ${EndIf}
!macroend

!endif ; !BUILD_UNINSTALLER

; ───────────────────────────────────────────────────────────────
; customUnInstall:
;   세 가지 경로를 명령행 인자 + ${Silent} 로 구분.
;
;   1) NSIS 자동 업그레이드 (Silent + --force-run 없음)
;      새 인스톨러가 옛 버전 uninstaller 를 자동 silent 호출.
;      사용자 데이터(시트 링크, SA JSON, localStorage, 카테고리 캐시,
;      자동실행 토글 등)는 그대로 보존되어야 한다.
;      → 어떤 흔적도 지우지 않음.
;
;   2) in-app [앱 삭제하기] (Silent + --force-run 있음)
;      앱 안의 모달에서 명시적으로 삭제 의도. electron 의 main.js 가
;      spawn 시 "/S --force-run" 으로 호출.
;      → 모든 흔적 완전 정리.
;
;   3) 사용자 수동 제거 (Silent 아님)
;      제어판 / 시작메뉴 / 설치 폴더의 uninstaller 직접 실행.
;      → 모든 흔적 완전 정리.
; ───────────────────────────────────────────────────────────────
!macro customUnInstall
  ${GetParameters} $R0
  ${GetOptions} $R0 "--force-run" $R1
  ${IfNot} ${Errors}
    StrCpy $R2 "wipe"
  ${ElseIf} ${Silent}
    StrCpy $R2 "preserve"
  ${Else}
    StrCpy $R2 "wipe"
  ${EndIf}

  ${If} $R2 == "preserve"
    ; ── 업그레이드 경로: 데이터 보존 ──
    DetailPrint "Silent uninstall (upgrade) — preserving user data"
  ${Else}
    ; ── 완전 제거 경로 (in-app 삭제 또는 수동 uninstall) ──
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
    DeleteRegKey HKCU "Software\${PRODUCT_NAME}"

    ; 사용자 데이터/캐시 폴더 강제 삭제 (실패해도 무시됨)
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"

    ; electron-builder 자동 업데이트 캐시 폴더 (이름은 package.json 의 npm name + "-updater")
    ; 우리 경우: %LOCALAPPDATA%\inel_scheduler-updater
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"

    ; 설치 폴더 자체가 비어있으면 같이 정리
    ; (사용자가 직접 만든 파일이 있으면 NSIS 가 알아서 보존)
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
