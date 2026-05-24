# src/ — 렌더러 (React + TypeScript) 컨벤션

## 파일 구조
- `App.tsx` — **거의 모든 컴포넌트/상태/IPC 구독이 여기 집약** (~4000+ 줄, 의도적 단일 파일).
- `main.tsx` — React 진입점. 거의 안 만집.
- `styles.css` — 단일 CSS. White & Soft Pink 테마.
- `assets/` — 정적 이미지/SVG.
- `data/chzzk-categories.seed.json` — Chzzk 카테고리 시드.

## App.tsx 분할 정책 (중요)
- **임의 분할 금지**. 사용자가 명시 요청하기 전엔 단일 파일 유지.
- 이유: 한 화면에서 상태/IPC/스타일이 강하게 얽혀 있어 분리 비용이 크고, 분리해도 임포트가 많아져 가독성이 떨어짐.
- 단, 다음 경우는 분할 검토 OK:
  - 진짜 재사용되는 작은 컴포넌트가 3+곳에서 import 되는 경우
  - 사용자가 명시적으로 "이 부분 분리해줘" 요청
- 분할할 때도 **상태는 App.tsx 에 남기고, 표현만 별도 컴포넌트로**. props로 내려보내기.

## 상태 (state) 카탈로그
주요 영구 상태는 `localStorage` 키와 짝지어 관리:

| 상태 | localStorage 키 | 비고 |
|---|---|---|
| `appData.rowsByTab` | `inel.rowsByTab.v1` | 500ms 디바운스 저장 |
| `appData.schemaByTab` | `inel.schemaByTab.v1` | 변경 즉시 저장. 기본 schema와 머지 로드 |
| `sortOrderByTab` | `inel.sortOrderByTab.v1` | 최신/이전 |
| `isDetecting` | `inel.isDetecting.v1` | 방송감지 자동 재개 |
| AI 상태 (provider/key/model) | `inel.aiState.v1` | BYOK |
| 그룹 접힘 / 가시 행 수 | `inel.groupCollapse.*`, `inel.visibleCount.*` | |

## IPC 호출 패턴
```ts
const result = await (window as any).electronAPI?.sheetsImport(url, tab, year, headers);
if (!result?.ok) { dlog(`...실패: ${result?.error}`); return; }
// result.rows 사용
```
- `(window as any).electronAPI?.X` 형태. `?.` 로 dev 환경(브라우저)에서 깨지지 않게.
- 결과는 `{ ok, ...payload }` 패턴 일관 — 메인 핸들러도 같은 모양.
- 이벤트 구독은 `useEffect` 안에서 `const off = electronAPI.onChzzkStatus(handler); return () => off();` 패턴.

## 디버그 로그
- 모든 의미 있는 분기에 `dlog(...)` 호출. 디버그 패널이 끄꺼져 있어도 메모리에 적재되어 "전체 복사" 가능.
- `dlog` 는 토큰 효율 위해 짧게. 도메인 약어 사용 OK (`ttlLen`, `pollMs` 등).

## 컬럼 / 스키마 시스템
- `ColumnDef`: `{ key, label, type, width, shared?, options? }`.
- `type`: `text` | `select` | `status` | `date` | `url` | `timeline` | `preset`.
- `shared: true` 인 컬럼은 영상별 공통 (담당자 row 와 무관).
- shorts/longform: 2-row 구조 (공유 + 담당자별).
- fullReplay: 1-row, timeline 컬럼은 read-only.

## 스타일링
- `styles.css` 한 파일에 누적. CSS-in-JS 도입 금지 (단일 파일 정책 일관).
- 테마 컬러: 핑크 계열 `#fce7f3` / `#fbcfe8` / `#f472b6` 등. 새 색 도입 시 기존 팔레트 우선.
- 새 버튼 만들 때 기존 `.icon-button`, `.connection-help-btn` 등 클래스 재활용 검토.

## 흔한 함정
1. **preload 변경 시 dev 모드 hot-reload 안 됨**. 새 IPC 추가 후 `electronAPI.x is not a function` 나오면 dev 완전 재시작.
2. **React StrictMode 더블 실행**: dev 모드에서 effect/log 2회 발생. 프로덕션 빌드에는 1회. 디버그 시 헷갈리지 않게.
3. **거대 `useMemo` 의존성 누락**: `filteredData` 같은 큰 메모는 의존성 정확히. sortOrderByTab, schemaByTab, rowsByTab 등.
4. **`window as any` 남발 금지**. 가능한 한 `Window` 인터페이스에 타입 선언 (이미 App.tsx 상단에 큰 declare global 블록 있음).

## 새 기능 추가 흐름
1. `docs/structure/code_flow.md` 에서 기존 함수 중복 검사.
2. 상태 추가가 필요한가? → `appData` 안에 둘지, `useState` 분리할지 결정.
3. IPC 추가 필요한가? → 4곳 동기화 (`electron/AGENTS.md` 참조).
4. localStorage 영구 저장 필요한가? → 키 명 `inel.<feature>.v<n>` 패턴.
5. 사용자 가이드 갱신 (`public/help/*.html`) 필요한가?
6. `dlog` 충분히 박았는가?
