# Scope Justification (영어)

OAuth Verification 신청 폼 안의 *"Why do you need each scope?"* 답변 초안.
Google 은 각 sensitive scope 마다 다음 두 가지를 알고 싶어 한다:

1. **What does your app do with this scope?** — 그 scope 를 어디서 어떻게 사용하는지
2. **How does this scope improve user experience?** — 왜 이 scope 가 꼭 필요한지

---

## App overview (전체 폼 위쪽 "App description" 항목)

> Inel Work Scheduler is a Windows desktop application for individual streamers
> who collaborate with freelance video editors and thumbnail designers. The app
> uses the user-owned Google Sheet as its only data store — there is no
> developer-side backend, no analytics server, and no advertising. The user's
> work schedule, video editor task list, and broadcast logs all live inside the
> user's own Google Sheet, and the app reads / writes that sheet to provide a
> dedicated desktop UI for managing it.
>
> The app is currently distributed privately to about 5–10 collaborators of the
> individual streamer who developed it (a Korean Chzzk live streamer named
> "Inel"). Editors and thumbnailers receive a custom installer that has the
> streamer's Google Sheet URL embedded; they log in with their own Google
> account, and the app verifies that their Gmail matches the one the streamer
> registered for them.

---

## Scope 1 — `https://www.googleapis.com/auth/spreadsheets`

**Sensitive scope (verification 필수)**

### What does your app do with this scope?

> The app reads and writes the single Google Sheet whose URL the user explicitly
> entered into the app's settings. The sheet has three tabs (Shorts, Longform,
> Replay) per year and contains rows representing individual video editing
> tasks — fields such as title, broadcast date, editor name, work status,
> delivery date, etc. The app synchronizes those rows bidirectionally:
> "Refresh Schedule" pulls the latest sheet content into the desktop UI, and
> "Save Changes" pushes the user's edits back to the sheet. The app does not
> access any other sheet — only the URL the user typed in.

### How does this scope improve user experience?

> Without `spreadsheets` scope the app cannot function. The user-owned Google
> Sheet is the single source of truth for all schedule data; the app itself
> intentionally keeps no separate database. Using the sheet as the store means
> the user can always open the same data in a browser (mobile, other PC) when
> the app is not available, and collaborators can be added or removed simply by
> sharing the sheet — there is no separate user management on our side.

### Notes for Google reviewer

> The app only accesses the spreadsheet whose URL the user provides. It never
> enumerates the user's drive, never lists other sheets, and never reads sheets
> that were not explicitly registered by the user.

---

## Scope 2 — `https://www.googleapis.com/auth/drive.file`

**Non-sensitive (per-file restricted)** — usually does not require verification
on its own, but Google's verification form will still ask for justification.

### What does your app do with this scope?

> The app uses `drive.file` only as a fallback for metadata operations on the
> same spreadsheet that the user registered. Specifically, when the registered
> sheet does not yet contain the per-year sub-sheets (e.g., "Shorts_2026"),
> the app creates them via the Sheets API; some of those operations internally
> need Drive file-level access. The app never lists, browses, or reads any
> Drive file that the user did not explicitly grant access to.

### How does this scope improve user experience?

> It allows the app to auto-create the per-year sub-sheets the first time the
> user clicks "Save Changes", so the user does not have to manually create
> sheets named "Shorts_2026", "Longform_2026", "Replay_2026" before using the
> app.

---

## Scope 3 — `https://www.googleapis.com/auth/userinfo.email`

**Non-sensitive**

### What does your app do with this scope?

> The app reads the email address of the user who just logged in. The email is
> displayed in the app's settings screen ("Currently logged in as
> name@example.com") and is used for one security check: editor / thumbnailer
> builds of the app have a specific email embedded at build time; if the email
> returned from userinfo does not match that embedded email, the app shows an
> "account mismatch" lock screen and refuses to proceed.

### How does this scope improve user experience?

> Without this scope the app cannot tell the user which Google account they are
> currently using, and cannot enforce the per-editor email match check. The
> email is not stored on any server, not used for analytics, and not used to
> contact the user.

---

## Limited Use disclosure (공통 문구)

> Inel Work Scheduler's use and transfer of information received from Google
> APIs to any other app will adhere to the Google API Services User Data
> Policy, including the Limited Use requirements.
>
> Specifically:
>
> - All data accessed via Google APIs is kept on the user's own machine and in
>   the user's own Google Sheet.
> - The app does not transfer Google user data to a remote server.
> - The app does not allow humans (including the developer) to read Google
>   user data, except (a) with the user's affirmative agreement for specific
>   pieces of data, (b) for security investigations, or (c) to comply with
>   applicable law.
> - The app does not use Google user data for serving advertisements.

---

## 추가 팁

- 답변은 **영어** 로 작성. 한국어 답변은 가끔 검토자가 번역 도구로 재해석하면서 의도가 어긋남.
- 각 답변에 **What** + **Why** 모두 포함. 둘 중 하나만 있으면 거절되기 쉬움.
- "personalize the user experience" 같은 모호한 표현 피하기. 구체적 기능명 / 화면명 / 사용자 액션으로 설명.
- 검토자가 데모 영상에서 그 동작을 확인할 수 있도록 demo-script.md 와 답변이 일치하게 작성.
