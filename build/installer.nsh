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
; (Installer 전용) 옵션 체크박스 페이지
; ───────────────────────────────────────────────────────────────
!ifndef BUILD_UNINSTALLER

Var InelOptDialog
Var InelDesktopShortcutCheckbox
Var InelDesktopShortcutState
Var InelAutoStartCheckbox
Var InelAutoStartState

!macro customPageAfterChangeDir
  Page custom InelOptionsPageCreate InelOptionsPageLeave
!macroend

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
  ${If} $InelDesktopShortcutState == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
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
;   언인스톨 시 모든 흔적을 깨끗이 정리.
;   - 바탕화면 바로가기
;   - 자동실행 Run 키
;   - PendingAutoStart 임시 키
;   - 사용자 데이터 폴더 (AppData / LocalAppData)
;
;   electron-builder 의 deleteAppDataOnUninstall: true 만으로는
;   $LOCALAPPDATA 의 Chromium 캐시(GPUCache, Code Cache 등)가 남는 경우가
;   있어 RMDir /r 로 안전망을 한 번 더 둔다.
; ───────────────────────────────────────────────────────────────
!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"

  ; 사용자 데이터/캐시 폴더 강제 삭제 (실패해도 무시됨)
  RMDir /r "$APPDATA\${PRODUCT_NAME}"
  RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"

  ; 설치 폴더 자체가 비어있으면 같이 정리
  ; (사용자가 직접 만든 파일이 있으면 NSIS 가 알아서 보존)
  RMDir "$INSTDIR"
!macroend
