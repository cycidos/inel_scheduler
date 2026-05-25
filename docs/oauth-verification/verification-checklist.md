# Verification 신청 단계별 체크리스트

진행 순서 그대로 따라가면 됨. 각 단계는 독립적이라 한 번에 다 안 해도 OK.

---

## Step 0 — 사전 준비 (5분)

- [ ] `docs/site/index.html` 의 `{{DEVELOPER_NAME}}`, `{{CONTACT_EMAIL}}` placeholder 채움
- [ ] `docs/site/privacy.html` 도 동일 placeholder 채움 (PowerShell 일괄 치환 추천 — `README.md` 참고)
- [ ] 본인 GitHub 계정 + 본인 Gmail (공개해도 괜찮은 것) 확인

---

## Step 1 — GitHub Pages 호스팅 (15분)

### 1-1. inel_scheduler 레포가 public 인지 확인
- GitHub 웹 → 본 레포 → 우상단 옵션 → Visibility 가 Public 이어야 함
- Private 이면: Settings → Danger Zone → Change visibility → Make public

### 1-2. docs/site/ 변경사항 push

```powershell
git add docs/site docs/oauth-verification
git commit -m "feat(verification): GitHub Pages 홈페이지 + 개인정보처리방침 + verification 가이드"
git push
```

### 1-3. GitHub Pages 활성화
- GitHub 웹 → 본 레포 → **Settings → Pages**
- **Source**: `Deploy from a branch`
- **Branch**: `main` (또는 작업 중인 브랜치를 main 에 병합 후) / Folder: `/docs`
- [Save]

### 1-4. URL 발급 + 접속 확인 (1~3분 대기 후)
- 발급 URL 형태: `https://{본인username}.github.io/inel_scheduler/`
- 다음 네 페이지 모두 404 없이 열리는지 확인 (한국어 + 영어):
  - [ ] `https://{본인username}.github.io/inel_scheduler/site/` (한국어 홈)
  - [ ] `https://{본인username}.github.io/inel_scheduler/site/privacy.html` (한국어 개인정보처리방침)
  - [ ] `https://{본인username}.github.io/inel_scheduler/site/index-en.html` (영어 홈)
  - [ ] `https://{본인username}.github.io/inel_scheduler/site/privacy-en.html` (영어 개인정보처리방침)
- 각 페이지 우상단 [English] / [한국어] 토글이 정상 동작하는지도 클릭해 확인

> docs/ 폴더를 Pages source 로 쓰면 `docs/site/index.html` 의 경로는 `/site/` 로 노출됨.

---

## Step 2 — 도메인 소유권 검증 (10분)

Google 의 OAuth Consent Screen 의 "Authorized domains" 에 등록한 도메인은 **Search Console 로 소유권 검증** 되어야 함.

### 2-1. Search Console 접속
- https://search.google.com/search-console
- 본인 Gmail 로 로그인

### 2-2. 속성 추가
- [속성 추가] → **URL 접두어** 선택 (Domain 아님)
- URL: `https://{본인username}.github.io/inel_scheduler/`
- [계속]

### 2-3. 소유권 확인 방법 선택
- 권장 방법: **HTML 파일 업로드**
  1. 다운로드된 `googleXXXXXXXX.html` 파일을 docs/site/ 에 복사
  2. push → GitHub Pages 자동 배포 대기 (1~2분)
  3. `https://{본인username}.github.io/inel_scheduler/site/googleXXXXXXXX.html` 접속해서 파일 내용 표시되는지 확인
  4. Search Console 의 [확인] 버튼 클릭
- 대안 방법: HTML 태그 (페이지의 `<head>` 에 `<meta>` 한 줄 추가)
  - HTML 파일 업로드보다 변동에 취약

### 2-4. 확인 완료
- [ ] "소유권이 확인되었습니다" 메시지 표시

> 한 번 확인되면 그 도메인이 Search Console 에 등록되어, OAuth 폼의 Authorized domains 에 `{본인username}.github.io` 를 추가할 수 있게 된다.

---

## Step 3 — OAuth Consent Screen 갱신 (10분)

### 3-1. Cloud Console 접속
- https://console.cloud.google.com/apis/credentials/consent
- 본 앱이 등록된 프로젝트 (`inel-scheduler`) 로 전환

### 3-2. OAuth Consent Screen 편집

**App information**:
- [ ] App name: `Inel Work Scheduler`
- [ ] User support email: `{본인 Gmail}`
- [ ] App logo: 본 레포의 `build/icon.png` 업로드 (또는 120x120 PNG)

**App domain**:
- [ ] Application home page: `https://{본인username}.github.io/inel_scheduler/site/index-en.html` (영어 권장)
- [ ] Application privacy policy link: `https://{본인username}.github.io/inel_scheduler/site/privacy-en.html` (영어 권장)
- [ ] Application terms of service link: (비워둠 — 약관은 필수 아님)

> Google 검토팀은 글로벌(영어)이라 영어 페이지 URL 을 제출하는 게 통과율을 높입니다.
> 한국어 페이지는 같은 페이지의 우상단 [한국어] 토글로 접근 가능하니 한국어 사용자에게도 문제 없음.

**Authorized domains**:
- [ ] `{본인username}.github.io` 추가

**Developer contact information**:
- [ ] Email addresses: `{본인 Gmail}`

[Save and Continue]

### 3-3. Scopes 단계
- 이미 등록된 scope 확인:
  - [ ] `https://www.googleapis.com/auth/spreadsheets`
  - [ ] `https://www.googleapis.com/auth/drive.file`
  - [ ] `https://www.googleapis.com/auth/userinfo.email`
- 없으면 [Add or Remove Scopes] → 위 세 가지 추가
- [Save and Continue]

### 3-4. Test users (현재 단계 유지용)
- 현재 등록되어 있는 Test users 그대로 두기. Verification 통과까지는 여전히 Test mode 로 운영해야 신청 가능.
- [Save and Continue]

### 3-5. Summary 확인 후 [Back to Dashboard]

---

## Step 4 — 데모 영상 녹화 + 업로드 (30~60분)

- [ ] `demo-script.md` 시나리오대로 녹화 (OBS / Win+G / Snagit 등)
- [ ] 5분 이내 / 1080p 권장
- [ ] 영문 자막 또는 화면 텍스트 필수
- [ ] YouTube 업로드 → **공개 범위: Unlisted (일부 공개)** 선택
- [ ] 영상 URL 메모

> 영상은 신청 후 검토 중에도 보완 요청에 따라 다시 찍어야 할 수 있음. 원본 파일은 보관.

---

## Step 5 — Verification 신청 제출 (15분)

### 5-1. OAuth Consent Screen → [PUBLISH APP] 클릭
- 상태가 `Testing` → `In production` 으로 변경되며, verification 폼이 열림

### 5-2. Verification 요청 폼 작성

**App description** (앱이 무엇을 하는지):
- `scope-justification.md` 의 *App overview* 섹션 복붙

**For each sensitive scope** (각 sensitive scope 별로 답변):
- `scope-justification.md` 의 *Scope 1 / 2 / 3* 섹션 복붙

**Demo video URL**:
- Step 4 에서 받은 YouTube unlisted URL

**Will you affirm that you will only use Limited Use data...?**:
- [ ] Yes 체크

[Submit for verification]

### 5-3. 확인 이메일
- 신청 후 즉시 Google 로부터 "Your verification request has been received" 이메일 도착
- [ ] Gmail 받은편지함 확인

---

## Step 6 — Google 검토 응대 (1~6주)

검토 진행 상황:

1. **첫 자동 응답** (1~3일) — 폼 접수 확인
2. **사람 검토자 첫 회신** (5~14일) — 보완 요청 또는 승인
3. **보완 → 재제출** (필요 시) — 한 번에 통과되는 경우는 드물고, 보통 1~2회 왕복
4. **최종 승인** (2~6주)

### 흔한 보완 요청 케이스 + 대응

| 요청 | 대응 |
|---|---|
| "Your privacy policy does not clearly describe what data your app accesses" | `privacy.html` §2 (수집 정보) / §6 (OAuth scope) 를 더 구체적으로 작성하여 push |
| "Your demo video does not show the spreadsheets scope being used" | `demo-script.md` Scene 3 부분을 다시 녹화하여 영상 갱신 |
| "Your home page does not describe how the app uses Google data" | `index.html` 의 OAuth 권한 안내 섹션을 보강하여 push |
| "Domain not verified" | Search Console 의 소유권 검증을 다시 확인 (HTML 파일이 접근 가능한지) |

회신은 폼 안의 답변창 또는 이메일 둘 다 사용 가능.

---

## Step 7 — 승인 (경고 화면 사라짐)

- [ ] 승인 이메일 수신
- [ ] OAuth Consent Screen 의 Verification status 가 `Verified` 로 바뀜
- [ ] 본인 또는 다른 Gmail 로 로그아웃 후 재로그인 → 경고 화면이 더 이상 표시되지 않음 확인

> 이제 100명 한도가 풀려 누구든 본 앱으로 로그인 가능. Test users 명단도 더 이상 의미 없음.

---

## 참고

- Verification 결과는 **앱 단위** 가 아니라 **OAuth Client 단위** 로 부여됨. 같은 Client ID 를 쓰는 모든 빌드 (admin / editor / thumbnailer) 에 자동 적용.
- 새 scope 를 추가하면 그 시점부터 재검토 필요. 현재 3개로 안정화되어 있으니 당분간 추가 신청 불필요.
- 1년에 한 번 정도 Google 이 *security assessment* 갱신을 요구할 수 있지만, 우리는 데이터를 외부로 보내지 않는 데스크톱 앱이라 보통 면제됨.
