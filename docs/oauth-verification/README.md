# Google OAuth Verification 신청 가이드

`Inel Work Scheduler` 의 Google OAuth Consent Screen 을 **Testing → Production + Verified** 로 승격하기 위한 작업 일체.

승격되면 사용자가 [Google 로그인] 시 보던 *"Google에서 확인하지 않은 앱"* 경고 화면이 사라진다.

---

## 왜 필요한가

본 앱이 사용하는 OAuth scope 중 `https://www.googleapis.com/auth/spreadsheets` 는 Google 이 **Sensitive scope** 로 분류한 범위라서, Test mode 또는 unverified production 상태에선 경고 화면이 표시된다.

승인 절차를 통과하면 그 경고가 사라지고, 100명 한도도 풀려 누구든 본 앱을 사용할 수 있다.

---

## 전체 작업 흐름

```
[1] 공개 페이지 호스팅          ← docs/site/ + GitHub Pages
[2] 도메인 소유권 검증          ← Google Search Console
[3] OAuth Consent Screen 갱신   ← Cloud Console
[4] 데모 영상 녹화 + 업로드     ← YouTube unlisted
[5] Verification 신청 제출      ← Cloud Console
[6] Google 검토 응대 (1~6주)    ← 이메일 회신
[7] 승인 → 경고 사라짐
```

각 단계별 자세한 절차는 `verification-checklist.md` 참고.

---

## 산출물 파일

| 파일 | 용도 |
|---|---|
| `docs/site/index.html` | 홈페이지 — 앱 소개 |
| `docs/site/privacy.html` | 개인정보처리방침 |
| `docs/oauth-verification/scope-justification.md` | 신청서의 "Why do you need this scope?" 영어 답변 초안 |
| `docs/oauth-verification/demo-script.md` | YouTube unlisted 데모 영상 시나리오 |
| `docs/oauth-verification/verification-checklist.md` | 단계별 체크리스트 |

---

## 채워야 할 placeholder

`docs/site/*.html` 안의 다음 placeholder 를 본인 정보로 교체:

| Placeholder | 무엇을 채우나 |
|---|---|
| `{{DEVELOPER_NAME}}` | 본인 이름 또는 활동명 (예: "이늘") |
| `{{CONTACT_EMAIL}}` | 공개 문의 이메일 (verification 신청 시 같은 이메일 권장) |

PowerShell 일괄 치환 예시:

```powershell
$dev = "이늘"
$mail = "your-email@gmail.com"
Get-ChildItem docs\site\*.html | ForEach-Object {
  (Get-Content $_.FullName -Raw) `
    -replace "\{\{DEVELOPER_NAME\}\}", $dev `
    -replace "\{\{CONTACT_EMAIL\}\}", $mail `
    | Set-Content -Path $_.FullName -Encoding UTF8
}
```

---

## GitHub Pages 호스팅 설정

### 옵션 A: 기존 `inel_scheduler` 레포에 같이 호스팅 (가장 빠름)

전제: 레포가 **public** 이어야 함. (private 레포 + GitHub Pages 는 GitHub Pro 필요)

1. 본 레포 push 후 GitHub 웹에서:
   - **Settings → Pages → Source**: `Deploy from a branch`
   - **Branch**: `main` / Folder: `/docs` 선택 → Save
2. 약 1~2분 대기 → URL 발급:
   - `https://{{GITHUB_USERNAME}}.github.io/inel_scheduler/site/`
3. 접속 테스트:
   - 홈: `.../inel_scheduler/site/index.html`
   - 개인정보처리방침: `.../inel_scheduler/site/privacy.html`

### 옵션 B: 별도 public 레포 만들기

레포가 private 이거나 따로 관리하고 싶으면:

1. GitHub 웹에서 새 public 레포 `inel-scheduler-site` 생성
2. 로컬에서:
   ```powershell
   mkdir ..\inel-scheduler-site
   cd ..\inel-scheduler-site
   git init
   Copy-Item ..\inel_scheduler\docs\site\* . -Recurse
   git add .
   git commit -m "init: landing + privacy"
   git remote add origin https://github.com/{{GITHUB_USERNAME}}/inel-scheduler-site.git
   git branch -M main
   git push -u origin main
   ```
3. 그 레포 Settings → Pages → Branch `main` / Folder `/ (root)` → Save
4. URL: `https://{{GITHUB_USERNAME}}.github.io/inel-scheduler-site/`

> 옵션 A 가 더 빠름. 추후 옵션 B 로 마이그레이션해도 됨.

---

## 신청 양식에 들어갈 URL (예시)

| 항목 | URL |
|---|---|
| Application home page | `https://{{GITHUB_USERNAME}}.github.io/inel_scheduler/site/` |
| Privacy policy | `https://{{GITHUB_USERNAME}}.github.io/inel_scheduler/site/privacy.html` |
| Authorized domain | `{{GITHUB_USERNAME}}.github.io` |
| YouTube demo video | (영상 업로드 후 unlisted URL) |

---

## 다음 단계

이 README 다음 순서로 진행:

1. `verification-checklist.md` 따라 GitHub Pages / Search Console 셋업
2. `demo-script.md` 따라 영상 녹화
3. `scope-justification.md` 의 영어 답변을 신청 폼에 그대로 또는 약간 수정해서 제출
