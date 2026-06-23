# Inel Work Scheduler — Repository Map

> 이 문서는 Cursor 에이전트가 디렉토리 진입 시 자동 로드합니다.
> 큰 그림과 "어디서 무엇을 찾는지"만 둡니다. 도메인 규칙은 하위 `AGENTS.md` 로 분산.

## 한 줄 요약
치지직 스트리머 "이늘"과 편집자/썸네일러 팀의 작업/방송 일정 관리 데스크탑 앱 (Electron + React + TypeScript).

## 디렉토리 지도

```
inel_scheduler/
├── electron/             ← 메인 프로세스 (Node.js). IPC, Google Sheets API, Chzzk API, NSIS 후처리.
│   ├── main.js                 ← 모든 IPC 핸들러 집중. ~900 줄.
│   └── preload.js              ← contextBridge 노출. window.electronAPI.* 인터페이스.
│
├── src/                  ← 렌더러 (React + TS + Vite).
│   ├── App.tsx                 ← 거의 모든 UI/상태 집약. ~4000+ 줄 의도적 단일 파일.
│   ├── main.tsx                ← React 진입점. 거의 안 건드림.
│   ├── styles.css              ← 단일 CSS. White & Soft Pink 테마.
│   ├── assets/                 ← 로고/아이콘
│   └── data/chzzk-categories.seed.json  ← 카테고리 시드
│
├── build/                ← electron-builder 리소스.
│   ├── icon.png                ← 인스톨러/앱 아이콘
│   └── installer.nsh           ← NSIS 커스텀 매크로 (자동실행, 언인스톨 정리 등)
│
├── public/help/          ← 앱 안에서 보여주는 가이드 HTML + GIF (구글 시트 셋업 / AI 셋업 / 사용법)
│
├── docs/                 ← 사람용 문서. 코드 변경 시 동기화 의무 있음 (`code_flow.md`).
│   ├── Dev_Rule.md
│   ├── structure/code_flow.md         ← 클래스/함수/컴포넌트 색인. 신규 추가 전 필독.
│   └── plans/                          ← 단계별 계획 문서
│
├── scripts/
│   └── seed-chzzk-categories.mjs       ← Chzzk 카테고리 시드 생성기
│
├── reference/            ← 참조용 외부 코드. .cursorignore 등록. 복사/모방 금지.
│
├── release/              ← 빌드 산출물 (.exe 등). .cursorignore 등록.
│
├── package.json          ← scripts/dependencies/electron-builder config 통합
├── tsconfig.json
├── vite.config.ts
└── .cursor/              ← 에이전트 하네스
    ├── rules/                  ← alwaysApply / globs 룰
    └── skills/                 ← on-demand 도메인 스킬
```

## 양 프로세스 데이터 흐름

```
┌────────────────────────────┐         ipcRenderer.invoke           ┌─────────────────────────┐
│  Renderer (src/App.tsx)    │ ─────────────────────────────────▶   │  Main (electron/main.js)│
│                            │                                       │                         │
│  React state + UI          │ ◀─── ipcMain webContents.send ───── │  - googleapis 호출      │
│  - rowsByTab               │                                       │  - chzzk API 폴링       │
│  - schemaByTab             │                                       │  - 파일 IO              │
│  - sortOrderByTab          │                                       │  - NSIS 언인스톨러 spawn│
│  - isDetecting             │                                       │                         │
│  - aiState                 │                                       └─────────────────────────┘
│                            │                                                    │
│  localStorage 영구 저장     │                                                    ▼
└────────────────────────────┘                                       Google Sheets / Chzzk / 파일시스템
```

## 주요 IPC 핸들러 카테고리

| 카테고리 | IPC 채널 prefix | 동기 파일 |
|---|---|---|
| Google Sheets | `sheets-*` (test, import, export, patch-row) | main.js, preload.js |
| Chzzk | `chzzk-*` (start, stop, status, title-change, category-change, error) | main.js, preload.js |
| 카테고리 사전 | `category-*` (load, register-user) | main.js |
| AI Model | `ai-list-models`, `ai-map-csv` | main.js |
| 시스템 | `open-user-data-dir`, `app-uninstall`, `set-auto-start`, `get-auto-start` | main.js |
| 도움말 | `open-help-*` | main.js |

각 채널은 4곳 동기화 의무: `main.js` 핸들러 + `preload.js` 노출 + `App.tsx` 호출 + `docs/structure/code_flow.md` 기록.

## 브랜치 / 배포 전략

| 브랜치 | 용도 | 빌드 | 상태 |
|---|---|---|---|
| `master` | 1차 배포 (관리자 풀 기능) | NSIS, 1.0.0 | 안정 |
| `feature/phase2-installer-ui` | 2차 배포 (편집자/썸네일러 토큰 인스톨러) | 미정 | 진행 중 |

- master 의 기능 추가는 phase2 로 cherry-pick.
- phase2 의 편집자 전용 UI는 master 로 역흐름 금지.

## 빌드 명령

| 작업 | 명령 |
|---|---|
| 개발 | `npm run dev` |
| 웹 빌드만 | `npm run build:web` |
| 인스톨러 빌드 | `npm run dist` |
| dir-only (서명 검증용) | `npm run dist:dir` |
| 카테고리 시드 갱신 | `npm run seed:chzzk-categories` |

## 다음 단계 진입 시 읽으면 좋은 문서

- `.cursor/rules/00-project-context.mdc` — 전반 컨텍스트 (이미 자동 로드됨)
- `docs/structure/code_flow.md` — 신규 함수/컴포넌트 추가 전
- `electron/AGENTS.md` — main/preload 작업 시
- `src/AGENTS.md` — UI 작업 시
- `.cursor/skills/sheets-sync/SKILL.md` — 시트 동기화 작업 시 (on-demand)
- `.cursor/skills/chzzk-detection/SKILL.md` — 방송감지 작업 시 (on-demand)
