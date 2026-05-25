# YouTube Unlisted 데모 영상 시나리오

OAuth Verification 신청에 첨부할 데모 영상 시나리오. **3 ~ 5분** 권장. 너무 길면 검토자가 끊어보다 거절하기 쉬움.

---

## 영상 요구 사항 (Google 가이드)

Google 의 검토자는 영상에서 다음을 확인할 수 있어야 한다:

1. ✅ **OAuth Consent Screen 노출** — Google 로그인 화면의 scope 동의 화면이 보여야 함 (앱 이름 + scope 목록)
2. ✅ **각 sensitive scope 의 실제 사용 장면** — 단순히 "spreadsheets 권한이 필요해요" 가 아니라, 그 scope 로 *실제* 시트를 읽고 쓰는 동작이 영상에 있어야 함
3. ✅ **앱과 Google 서비스 사이의 데이터 흐름**
4. ✅ **앱 이름** 이 영상 안에 명시 (윈도우 타이틀바 또는 자막)

영상에 음성 / 자막 / 화면 텍스트 중 하나로 각 단계를 설명.

---

## 녹화 도구 추천

| 도구 | 설명 |
|---|---|
| **OBS Studio** (무료) | 윈도우 단일 캡처 + 마우스 강조 + 화면 일부 흐리기 가능 |
| **Windows + G** (게임바) | Win10/11 기본. 가장 빠름. 마우스 따라가기 없음 |
| **Snagit / Camtasia** | 유료. 편집까지 한 번에 |

음성 녹음이 부담이면 무음 + 화면 자막으로 진행. 검토자는 자막만으로도 충분히 이해함.

---

## 시나리오 (5분 분량)

### Scene 1 — 인트로 (10초)

- 화면: 본 앱의 윈도우. 타이틀바에 "Inel Work Scheduler" 보임
- 자막:
  > "Inel Work Scheduler is a Windows desktop app for managing video editing schedules. All data is stored in the user's own Google Sheet."

### Scene 2 — OAuth 동의 화면 (30초) ★ **필수**

- 액션:
  1. 앱 상단 톱니바퀴 → [구글 시트] 탭
  2. [Google 계정으로 로그인] 클릭
  3. 시스템 브라우저에서 Google 로그인 페이지 열림
  4. 본인 Gmail 로 로그인
  5. **scope 동의 화면** 표시 (`Inel Work Scheduler wants to access your Google Account`)
  6. 권한 목록 명시 (영문):
     - `See, edit, create, and delete all your Google Sheets spreadsheets`
     - `See, edit, create, and delete only the specific Google Drive files you use with this app`
     - `See your primary Google Account email address`
  7. [Allow] 클릭
  8. 브라우저에서 "로그인 완료" 한국어 페이지 → 자동 닫힘
  9. 앱 화면으로 복귀, "현재 본인이메일 계정으로 로그인" 표시 확인
- 자막:
  > "The app uses Google OAuth 2.0 to request access to the user's own spreadsheet."

### Scene 3 — `spreadsheets` scope 실제 사용 (90초) ★ **필수**

- 액션:
  1. 앱 [구글 시트] 탭에서 시트 URL 입력 (이미 채워져 있으면 그대로)
  2. [연결 테스트] → "연결 성공" 메시지
  3. 상단 [일정 새로고침] 버튼 클릭
  4. 진행률 바 표시 → 시트의 데이터가 앱의 표에 로드되는 모습
  5. 앱의 표에서 셀 하나 직접 편집 (예: 영상 제목 변경, 작업 상태 dropdown 변경)
  6. 상단 [변경사항 저장] 버튼 클릭
  7. **브라우저로 전환** → 같은 Google Sheet 를 열어서 변경 사항이 시트에도 반영되었음을 확인
- 자막 (각 단계마다):
  > "(spreadsheets scope) Refresh Schedule pulls the sheet content into the app."
  >
  > "The user edits a row inside the desktop UI."
  >
  > "Save Changes pushes the edit back to the user's own Google Sheet."

### Scene 4 — `drive.file` scope (30초)

- 액션:
  1. 비어 있는 새 시트 URL 을 입력 (또는 그 상태의 시트를 미리 준비)
  2. [변경사항 저장] 클릭
  3. 진행률 바 표시 → 앱이 시트에 자동으로 "Shorts_2026 / Longform_2026 / Replay_2026 / _settings" 시트를 생성
  4. 브라우저로 전환 → 시트의 탭 하단에 새 시트들이 생긴 것 확인
- 자막:
  > "(drive.file scope) When the registered sheet does not yet contain the per-year sub-sheets, the app creates them so the user does not have to do it manually."

### Scene 5 — `userinfo.email` scope (20초)

- 액션:
  1. 앱 [구글 시트] 탭 → "Google 계정 연결" 카드에 로그인한 본인 이메일이 표시되어 있음을 보여줌
  2. 자막으로 별도 사용처 설명
- 자막:
  > "(userinfo.email scope) The app reads the logged-in user's email to display it in settings, and to verify that editors are using the Gmail their administrator registered for them."

### Scene 6 — 데이터 저장 위치 (30초)

- 액션:
  1. 앱 [기타 설정] 탭 → [폴더 열기] 클릭
  2. Windows 탐색기에서 `%APPDATA%\Inel Work Scheduler\` 폴더가 열림
  3. 안에 있는 파일을 보여줌:
     - `oauth-tokens.bin` (암호화된 refresh token)
     - `chzzk-categories-user.json` (사용자 추가 카테고리)
- 자막:
  > "All data is stored on the user's local PC and in the user's own Google Sheet. The OAuth refresh token is encrypted with Electron safeStorage / Windows DPAPI."
  >
  > "There is no developer-side backend, no analytics server, no advertising network."

### Scene 7 — 권한 회수 (20초)

- 액션:
  1. 브라우저에서 `myaccount.google.com/permissions` 열기
  2. "Inel Work Scheduler" 항목 보여줌
  3. (영상 끝에서 실제 회수까지는 안 해도 됨, 어디서 회수 가능한지만 보여주면 충분)
- 자막:
  > "Users can revoke the app's access at any time from their Google Account → Security → Connected apps."

### Scene 8 — 마무리 (10초)

- 자막:
  > "Inel Work Scheduler follows the Google API Services User Data Policy and the Limited Use requirements."

---

## 영상 업로드

1. YouTube 에 업로드
2. **공개 범위: Unlisted (일부 공개)** 선택
3. 영상 URL 복사 → Verification 신청 폼에 붙여넣기

> 공개로 올리지 않아도 됨. Google 검토자가 URL 만 있으면 볼 수 있음.

---

## 거절 사례 / 피해야 할 것

| ❌ 피하기 | ✅ 권장 |
|---|---|
| OAuth consent screen 캡쳐만 보여주기 | 실제 로그인 흐름 처음부터 끝까지 |
| "이 scope 가 필요합니다" 라고만 자막 | 그 scope 로 *실제 동작* 하는 화면 |
| 음성 한국어 / 자막 없음 | 영문 자막 또는 화면 텍스트 필수 |
| 영상 10분 이상 | 5분 이내 |
| 화질 480p 이하 | 1080p 권장 (자막 / 동의 화면 글자가 읽혀야 함) |
| 영상 중간에 다른 앱 로고 / 광고 | 본 앱만 노출 |
