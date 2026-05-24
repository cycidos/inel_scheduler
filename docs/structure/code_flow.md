# 코드 플로우 (code_flow)

> 중복 구현 방지와 구조 파악을 위한 코드 지도 문서.
> 구현 전 확인하고, 구현 후 갱신한다.

---

## 운영 규칙
1. 새 코드 작성 전, 동일 책임의 코드가 이미 있는지 먼저 확인
2. 새 클래스/함수/컴포넌트 추가 시 본 문서에 즉시 반영
3. 파일 이동/삭제/이름 변경 시 문서도 같이 수정
4. export 대상(외부에서 사용하는 요소) 위주로 정리

---

## 현재 프로젝트 상태 (초기)

### 루트
- Electron + React + TypeScript 스캐폴딩 완료
- 실행 스크립트:
  - `npm run dev` (Vite + Electron 동시 실행)
  - `npm run build:web` (웹 번들 빌드)
  - `npm run start` (Electron 단독 실행)

### 예정 영역
- 협업 Work Scheduler 앱(Electron)
- 상단 탭 기반 화면 (Shorts / Longform / Full Replay)
- 컬럼 타입 시스템 (Notion형 헤더 추가/삭제/타입 지정)
- Google Sheets 링크 연동 계층 (가져오기/내보내기)
- 치지직 업타임 타임라인 수집 계층 (제목/카테고리 변경 누적)
- 설치 패키지 빌드/배포 계층 (Windows Installer)

### 최신 우선 계획 문서
- `docs/plans/work_scheduler_app_plan_v1.md`

---

## 현재 코드 맵 (v0)

`파일 경로 | 이름 | 타입 | 역할 | 의존성`

`electron/main.js | createWindow | function | Electron 메인 창 생성 및 dev/prod 로딩 분기 | -> electron/preload.js`

`electron/preload.js | electronAPI | bridge | 렌더러에 최소 브리지 API 노출 | -`

`src/main.tsx | App bootstrap | entry | React 루트 마운트 | -> src/App.tsx`

`src/App.tsx | App | component | Work Scheduler 기본 탭(Shorts/Longform/Full Replay) 및 테이블 렌더링 | -> src/styles.css`

`src/App.tsx | tableSchema / buildShortLongSchema | const+factory | 탭별 기본 컬럼 정의. shorts/longform: 업로드/방송일/영상제목/영상카테고리(shared) + 담당자/편집유형/자막/작업시작일/작업상태/납품일/원본공유/납품공유(per-role). fullReplay: 업로드/방송일/영상제목/카테고리타임라인 (모두 shared, 컬럼 폭 고정). 편집유형/자막은 type=preset (썸네일러 기본 "-", 영상편집자 기본 "미설정"). 작업상태는 type=status (statusOptions 사용) | -`

`src/App.tsx | spacer-col (thead/tbody/tfoot) | layout | table-layout:fixed에서 컬럼 합이 화면 폭보다 작을 때 다른 컬럼이 비례 확장되지 않도록 마지막에 빈 spacer th/td 추가. width:auto + min-width:0으로 남는 공간 흡수. shared rowSpan과 호환되도록 spacer td는 isFirstSub일 때 rowSpan=hasTwoRows?2:1 | -`

`src/App.tsx | ColumnType "preset" / ColumnDef.presetOptions / presetDefaults | type field | 옵션 dropdown + 직접 입력 가능한 단일값 셀. role별 초기값 지정 가능 (thumbnailer/editor/default) | -`

`src/App.tsx | EDIT_TYPE_OPTIONS / SUBTITLE_OPTIONS | const | 편집유형(미설정/하이라이트편집/컷편집/무편집/풀편집/-), 자막(미설정/기본자막/자막X/효과자막포함/-) 후보 | -`

`src/App.tsx | renderCellEditor (preset 분기) | function | preset pill 버튼 클릭 시 dropdown(옵션 + "직접 입력" Enter). 값 종류별 색 (preset-dash/unset/filled). openPresetMenuKey/presetCustomInput state로 관리, 외부 클릭 닫기 적용 | -> updateCell`

`src/App.tsx | renderTaskRow (헬퍼) + 그룹 분리 렌더 | function+JSX | shorts/longform일 때 filteredData를 upload="완" 기준으로 todo/done 분리. 두 개의 group-section tbody (할 일 / 완료됨). 빈 그룹은 안내 메시지 한 줄. fullReplay는 단일 tbody | -> renderCellEditor`

`src/App.tsx | ColumnDef.shared | type field | true=영상 공통(rowspan 2), false/undefined=역할별(per-role) | -`

`src/App.tsx | RowItem.thumbnailer/editor | type field | per-role 컬럼 값 저장. shorts/longform RowItem에 둘 다 포함, fullReplay는 미포함 | -`

`src/App.tsx | createEmptyRow(columns, tab) | function | tab이 fullReplay가 아니면 thumbnailer/editor 빈 dict도 함께 생성 | -`

`src/App.tsx | updateCell(rowId, columnKey, value, role?) | function | role=null/undefined → row.values 갱신, role="thumbnailer"|"editor" → row[role] 갱신 | -`

`src/App.tsx | renderCellEditor(row, column, role?) | function | shared 컬럼은 row.values, per-role 컬럼은 row[role] 사용. cellRole에 따라 assignee 후보 자동 필터링 | -> updateCell`

`src/App.tsx | tbody 렌더링 (subRoles flat) | logic | hasTwoRows이면 RowItem당 [thumbnailer, editor] 두 tr 펼침. shared td는 첫 sub-row에만 rowSpan=2로 출력, 두 번째 sub-row에서는 td 생략 | -`

`src/App.tsx | renderCellEditor (upload 분기) | function | "업로드" 컬럼 셀: "완"/빈값 토글 버튼 (우측 정렬). 클릭 시 updateCell로 토글 | -> updateCell`

`src/App.tsx | dropTargetRowId/dropTargetColumnKey | state | 드래그 중 마우스가 올라간 행/열 ID (현재 swap 즉시 일어나서 indicator 사용 빈도 낮음, source opacity는 유효) | -`

`src/App.tsx | swapRow/swapColumn/endDrag | function | 드래그 중 dragOver 시점에 즉시 위치 swap. history는 첫 swap 1회만 push (dragHistoryPushedRef 사용). endDrag로 일괄 cleanup | -> pushHistory`

`src/App.tsx | dragHistoryPushedRef | useRef | 한 번의 드래그 동안 swap이 여러 번 일어나도 history는 1회만 push되도록 가드 | -`

`src/App.tsx | tbody row-action-col | layout | 행 hover-actions(드래그 핸들 + 삭제)를 위한 별도 좌측 36px 컬럼. 첫 데이터 컬럼 폭에 영향 없음. 드래그 핸들 버튼만 draggable | -`

`scripts/seed-chzzk-categories.mjs | seed crawler | script | 치지직 비공식 (1) /service/v1/lives POPULAR/LATEST 페이지네이션 + (2) /service/v1/search/lives 키워드 105개 검색(한글 자모/영문/인기게임/스포츠/ETC/엔터) 합쳐 unique 카테고리 시드 생성. ETC 카테고리는 명시 시드 우선 | -> https://api.chzzk.naver.com/service/v1/{lives,search/lives}`

`src/data/chzzk-categories.seed.json | seed | data | ~207개 카테고리 (GAME 191 / ETC 11 / SPORTS 3 / ENTERTAINMENT 2). 빌드 시 vite import로 renderer 번들에 포함. 활동 중 라이브가 있는 카테고리만 수집되며, 비활성/희귀 카테고리는 온라인 폴백(categories-search-online) + 다시보기 자동등록으로 보강 | -`

`electron/main.js | categories-search-online (IPC) | handler | 입력 키워드를 /service/v1/search/lives로 호출 → 라이브에서 unique 카테고리 추출(최대 limit개). CORS 회피 위해 main 프로세스에서 https GET | -> https://api.chzzk.naver.com/service/v1/search/lives`

`electron/preload.js | categoriesSearchOnline | bridge | 렌더러에서 categories-search-online IPC 호출 | -`

`src/App.tsx | onlineCategoryResults / onlineSearching / useEffect(debounce 350ms) | state+hook | 로컬(시드+사용자) 결과가 비었을 때만 비공식 search/lives 폴백. 응답 카테고리 중 로컬에 없는 항목만 표시 | -> categoriesSearchOnline`

`src/App.tsx | renderCellEditor (videoCategory dropdown 폴백 영역) | UI | 로컬 결과 + "치지직 라이브에서 발견 (선택 시 자동 등록)" 영역 분리 표시. 클릭 시 addUserCategory + commitNewTag 동시 실행 → 다음 export부터 시트에 텍스트로 반영 | -> addUserCategory, commitNewTag`

`src/styles.css | .category-section-label / .category-online / .category-online-badge | stylesheet | dropdown 섹션 라벨 + 온라인 폴백 항목용 점선 스타일 + "+ 등록" 칩 | -`

`src/styles.css | .category-input-spinner / .category-loading / .category-loading-spinner / .category-section-spinner | stylesheet | 폴백 검색 중 시각 표시. input 우측 12px 작은 스피너 + dropdown 안 18px 큰 스피너+안내 박스 + 결과 영역 라벨 우측 9px 스피너. category-spin keyframe 공유 | -`

`electron/main.js | categories-load-user (IPC) | handler | userData/chzzk-categories-user.json 로드. 사용자가 추가한 카테고리만 영구 저장 | -> fs`

`electron/main.js | categories-add-user (IPC) | handler | 새 카테고리를 user JSON에 추가 (중복 방지). 다시보기 자동감지에서 호출 예정 | -> fs`

`electron/main.js | chzzk-status uptime 계산 | logic | poll 응답에 openDate 가 있으면 그것을 KST 기준으로 파싱(now - openDate)해 uptime 산출. polling 시작 시각 기반 fallback 보다 우선 — 인터넷 끊김/감지 OFF→ON 으로 polling 이 재시작돼도 실제 방송 경과 시간을 유지 | -`

`src/App.tsx | ensureDetectRow | useCallback | (구 createDetectRow) 다시보기 탭의 활성 행을 보장. detectRowId 가 살아있으면 매칭 자체 no-op(가드1), 그렇지 않으면 (broadcastDate, broadcastStartTime[HH:MM:SS]) 핑거프린트로 다단계 매칭: 정확 매칭 → 분 단위(HH:MM) prefix fallback(가드2) → 실패 시 새 행. openDate 없으면 KST 현재시각(초까지) 폴백. 매칭 시 마지막 카테고리 줄과 status.category 비교해 firstCategoryRecorded 결정 (재진입 시 중복 라인 방지) | -`

`src/App.tsx | lastSeenOpenDate (ref) + onChzzkStatus 변화 감지 dlog | ref+logic | 같은 세션 polling 중 치지직이 주는 openDate 가 변하는지 검증용. 변화 발생 시 "주의: 같은 세션 내 openDate 변경 감지 ..." 디버그 로그 출력. LIVE OFF / 방송감지 토글 시 리셋 | -`

`electron/main.js | chzzk-status / chzzk-category-change payload 분리 | logic | 카테고리를 categoryId(영문 키), categoryValue(한글 표시명), categoryType(GAME/ETC/...) 셋으로 분리해서 송신. 비교/자동등록은 안정적 키 categoryId 기준. 호환 위해 category 필드(=display)도 유지 | -`

`electron/main.js | sheets-patch-row (IPC) | handler | 매칭 키 쌍(matchPairs)으로 시트 한 행을 식별 → update or append. 다시보기 카테고리 변경 즉시 반영용. 1) 시트 헤더 read → 2) 우리 schema label 중 시트에 없는 것은 헤더 끝에 자동 append (RAW 모드, 누락 컬럼 보충) → 3) 시트 헤더 인덱스 기반으로 keyToColIndex 재구성 (사용자가 시트 컬럼 순서 바꿔도 안전) → 4) rowOut 을 시트 헤더 길이만큼 만든 뒤 우리 schema 의 각 key 를 정확한 시트 컬럼 위치에 배치 → 5) update or append | -> sheetsClient.spreadsheets.values.{get,update,append}`

`electron/preload.js | sheetsPatchRow | bridge | renderer → main IPC 호출 래퍼 | -`

`src/App.tsx | flushPatchActiveRow + schedulePatchActiveRow + patchDebounceTimer | useCallback+ref | t12-a. detectRowId 가 가리키는 다시보기 활성 행만 sheets-patch-row IPC 로 시트에 즉시 반영. matchPairs=(broadcastDate,broadcastStartTime). 5초 디바운스로 카테고리 변경 폭주 시 호출 통합. LIVE OFF / 토글 OFF 시 즉시 flush | -> sheetsPatchRow`

`src/App.tsx | appDataRef / sheetLinkRef / allCategoriesRef | ref | useEffect deps 폭증 방지용. 활성 polling 핸들러 내부에서 setAppData/sheetLink/allCategories 의 최신 값을 ref 로 참조. 매 변경마다 useEffect 동기화 | -`

`src/App.tsx | onChzzkCategoryChange 자동 등록 분기 | logic | t12-b. change.nextId 가 allCategoriesRef.current 에 없으면 categoriesAddUser IPC 로 자동 등록 → setUserCategories 갱신. dlog 카테고리: [auto-register] | -> categoriesAddUser`

`electron/preload.js | categoriesLoadUser/categoriesAddUser | bridge | 렌더러 → main IPC 호출 래퍼 | -`

`src/App.tsx | seedCategories/userCategories/allCategories | const+state | 시드(json import) + user(IPC) 합쳐서 unique 목록 생성 | -> categoriesLoadUser`

`src/App.tsx | filteredCategories | useMemo | categorySearchQuery로 필터링된 카테고리 목록. 검색어 비어있으면 빈 배열 (미리보기 없음). 검색어 있을 때만 최대 50개 표시 | -`

`src/App.tsx | runImport / runExport | function | 시트 동기화 본체. syncPhase/syncProgress 갱신하며 3개 탭 순차 처리. handleImport/handleExport는 wrapper | -> electronAPI.sheetsImport/Export`

`src/App.tsx | syncPhase / syncProgress / autoSyncDoneRef | state+ref | idle/downloading/uploading/success/error 단계 + (current/total/label) 진행률 + 자동 동기화 1회 가드 | -`

`src/App.tsx | useEffect (자동 시작 동기화) | hook | localStorage에서 sheetLink+serviceAccountPath 모두 복원되면 자동으로 sheetsInitAuth → runImport 호출 (autoSyncDoneRef로 1회만) | -> sheetsInitAuth, runImport`

`src/App.tsx | meta 섹션 sync-indicator + sync-progress-bar | UI | 상단 meta 영역에 동기화 단계 라벨 + 진행률 막대 표시 | -`

`src/styles.css | .sync-indicator / .sync-progress-bar / .sync-progress-fill / .sync-progress-text | stylesheet | 동기화 상태 칩 (단계별 색)과 진행률 막대 (핑크 그라데이션) | -`

`src/App.tsx | addUserCategory | function | 사용자 카테고리 추가 (IPC 호출 + state 동기화). 다시보기 자동감지에서 사용 예정 | -> electronAPI.categoriesAddUser`

`src/App.tsx | renderCellEditor (videoCategory 검색 dropdown) | UI | "영상 카테고리" 셀의 + 클릭 시 검색 input + 자동완성 dropdown 표시. 카테고리 클릭 시 태그 추가, Enter로 직접 입력도 가능 | -> filteredCategories, commitNewTag`

`src/styles.css | .category-search-dropdown / .category-option / .category-tag-type | stylesheet | 카테고리 검색 자동완성 UI. 게임/ETC/스포츠별 색 칩 | -`

`package.json | seed:chzzk-categories | npm script | 시드 데이터 갱신 명령. 비공식 API 호출 (개발자만 사용) | -> scripts/seed-chzzk-categories.mjs`

`src/styles.css | .upload-toggle | stylesheet | 업로드 완료 토글 (빈: 회색 점선 / 완: 녹색 채움). margin-left: auto로 우측 정렬 | -`

`src/styles.css | .drop-target-col / .drop-target-row | stylesheet | 드래그 중 drop 위치 시각화 (핑크 inset shadow + 핑크 배경) | -`

`src/styles.css | .task-row-first / .task-row-second | stylesheet | 같은 영상의 두 sub-row 시각적 구분 (위는 굵은 핑크 보더, 아래는 점선) | -`

`src/styles.css | .role-cell.role-thumbnailer / .role-editor ::before | stylesheet | per-role 셀 좌측 컬러 바 (썸네일러: 주황, 영상편집자: 파랑) | -`

`src/styles.css | .shared-cell | stylesheet | rowspan 처리된 영상 공통 셀 배경 (옅은 핑크) + 수직 가운데 정렬 | -`

`src/App.tsx | initialRows | const | 탭별 초기 샘플 데이터 정의 | -`

`src/App.tsx | StaffMember/EditorRole/ROLE_LABEL | type+const | 편집자/썸네일러 등록 데이터 모델 | -`

`src/App.tsx | addStaff/removeStaff/normalizeName | function | 편집자 등록/삭제 + NFC 정규화 | -`

`src/App.tsx | renderCellEditor (assignee 분기) | function | "담당자" 컬럼 셀: 등록 인원 그룹화 드롭다운 표시 | -> staffList`

`src/App.tsx | registerJsonByPath/handleJsonDrop | function | Service Account JSON 드래그&드롭 등록 | -> electronAPI.sheetsInitAuth`

`src/App.tsx | copyClientEmail | function | 서비스 계정 client_email을 클립보드에 복사 | -> navigator.clipboard`

`src/App.tsx | testConnection | function | 시트 연결 테스트 (메타데이터 조회) | -> electronAPI.sheetsTestConnection`

`public/help/google-sheets-setup.html | static guide | static page | 8단계 Service Account 설정 가이드 정적 HTML. TOC + 단계 카드 + GIF + 외부링크. dev에선 vite가 public/ 그대로 서빙, 빌드 시 dist/help/로 복사 | -> public/help/gifs/*.gif`

`public/help/gifs/.gitkeep | placeholder | data | 8단계 가이드용 GIF 보관 디렉터리 (01-create-project.gif ~ 08-connection-test.gif). 미등록 시 가이드 페이지가 자동 placeholder 표시 | -`

`electron/main.js | help-open-sheets-setup (IPC) | handler | shell.openExternal로 시스템 기본 브라우저에 가이드 페이지 열기. dev=VITE_DEV_SERVER_URL, prod=file:// dist/help/google-sheets-setup.html | -> shell.openExternal`

`electron/preload.js | helpOpenSheetsSetup | bridge | 렌더러 → main의 help-open-sheets-setup 호출 | -`

`src/App.tsx | openSheetsSetupHelp | function | 연결 탭의 [설정 방법 자세히 보기] 버튼 클릭 시 IPC 호출 | -> electronAPI.helpOpenSheetsSetup`

`public/help/scheduler-app-guide.html | static guide | static page | 스케줄러 앱 사용 방법 가이드 정적 HTML. 8개 섹션 (상단바/탭/컬럼별 기능/행·열/다시보기 자동 누적/시트설정↔시트 연계/단축키/동기화). 시트 컬럼 카드 grid + 시트설정↔시트 연계 다이어그램 카드 + 키맵 | -`

`electron/main.js | help-open-app-guide (IPC) | handler | shell.openExternal로 scheduler-app-guide.html 열기. 내부적으로 openHelpPage(fileName) 헬퍼 공용 사용 | -> shell.openExternal`

`electron/preload.js | helpOpenAppGuide | bridge | 렌더러 → main의 help-open-app-guide 호출 | -`

`src/App.tsx | openAppGuideHelp | function | 시트 설정 탭 상단의 [사용 방법 자세히 보기] 배너 버튼 클릭 시 IPC 호출 | -> electronAPI.helpOpenAppGuide`

`src/App.tsx | groupCollapsed / toggleGroupCollapsed | state+function | 숏폼/롱폼 [할 일]/[완료됨] 그룹 접힘 상태. 탭별 + 그룹별 boolean. localStorage("inel-scheduler-group-collapsed")에 저장. 그룹 헤더 행 클릭으로 토글, ▾ caret이 회전(-90deg)으로 시각화. 두 그룹 사이에 group-spacer-tbody 한 줄(높이 14px)로 시각적 간격 | -`

`src/App.tsx | taskFilter / setTaskFilterFor | state+function | 탭별 작업 필터 ("todoOnly"|"all"). 기본 "todoOnly". "todoOnly"면 [완료됨] 그룹(헤더+spacer+행) 통째로 미렌더. localStorage("inel-scheduler-task-filter")에 저장. 월 페이저 옆 .task-filter-toggle UI | -`

`src/App.tsx | groupVisibleCount / adjustGroupVisible | state+function | 탭/그룹별 표시 행 수 (기본 10, 최소 5, 최대 30, 5단위 조절). 그룹 헤더 우측 .group-visible-control 컨트롤(− / + / "표시 N / 총 X · M개 더"). slice(0, count)로 자르고 초과분은 .group-overflow-cell 안내. localStorage("inel-scheduler-group-visible-count") | -`

`src/App.tsx | isRowLocked (renderTaskRow 내부) | computed | row.values.upload === "완"이면 tr에 row-locked 추가, 업로드 외 모든 td에 is-locked 추가. CSS로 회색화 + pointer-events 차단. row-action-col(드래그/삭제)와 업로드 토글은 잠금 제외 → 행 정리/해제 가능 | -`

`electron/main.js | ai-list-models (IPC) | handler | provider별(openai/anthropic/google) 공식 모델 API 호출 → 채팅용 모델만 필터, 최신순 정렬, 상위 5개 반환. 응답에는 ok/models/totalCount/elapsedMs/log 포함 | -> listOpenAIModels/listAnthropicModels/listGoogleModels`

`electron/main.js | ai-analyze-csv (IPC) | handler | csvHeader+sample+ourSchema → buildAnalyzePrompt → provider별 callOpenAI/callAnthropic/callGemini → extractJson → 매핑 JSON 반환. 단계별 trace[] 누적 (renderer가 dlog로 흘림) | -> buildAnalyzePrompt, callOpenAI/Anthropic/Gemini, extractJson`

`electron/main.js | help-open-ai-setup (IPC) | handler | ai-setup.html을 외부 브라우저로 오픈 (openHelpPage 헬퍼 사용) | -> shell.openExternal`

`electron/main.js | httpsRequest / extractJson / buildAnalyzePrompt | helper | provider 공통 https 호출, JSON 코드블록 스트립 + 첫 { ~ 마지막 } 파싱, 표준 컬럼 스키마 + 출력 JSON 형식 안내 프롬프트 | -`

`public/help/ai-setup.html | static guide | static page | provider별(OpenAI/Anthropic/Google) API 키 발급 절차, 모델 갱신 안내, 비용/프라이버시/문제 해결 6섹션 | -`

`electron/preload.js | aiListModels / aiAnalyzeCsv / helpOpenAiSetup | bridge | 위 IPC들의 렌더러 노출 | -`

`src/App.tsx | aiProvider / aiApiKey / aiModel / aiAvailableModels (+ persistAiState) | state | AI provider/키/모델 + 캐시된 최신 5개. localStorage("inel-scheduler-ai-{provider,apikey,model,models}")에 저장 | -`

`src/App.tsx | refreshAiModels | function | aiListModels IPC 호출 → top5 dropdown 갱신 + 디버그 로그 | -> electronAPI.aiListModels`

`src/App.tsx | settingsTab === "ai" panel | JSX | 설정 [AI 연결] 탭. provider select / API 키(보기 토글) / 모델 dropdown(5개) + [모델 갱신] 버튼 + 가이드 배너 | -`

`src/App.tsx | csvModalOpen / csvHeader / csvRows / csvPhase / csvMapping / csvConvertedRows / csvTargetTab | state | CSV 임포트 모달 전용 상태. csvPhase: idle/parsed/analyzing/analyzed/failed/uploading/uploaded | -`

`src/App.tsx | parseCSV | function | RFC4180 호환 간단 CSV 파서 (UTF-8 BOM, quoted field, escaped quote, CRLF/LF). 빈 행 자동 제거 | -`

`src/App.tsx | handleCsvFileLoaded / handleCsvDrop | function | CSV 파일 → text → parseCSV → header/rows 셋. 단계별 dlog([AI:csv]) | -> parseCSV`

`src/App.tsx | runCsvAnalyze | function | aiAnalyzeCsv IPC 호출, 응답 trace를 그대로 dlog. 성공 시 applyCsvMapping 실행. 실패 시 csvPhase=failed + 디버그 패널 안내 | -> electronAPI.aiAnalyzeCsv, applyCsvMapping`

`src/App.tsx | applyCsvMapping(mapping) | function | headerMap/valueMaps/dateFormat/splitColumns/twoRowAssignment 적용해 RowItem[] 생성. shared/ 역할별 컬럼 분리. 무효행 카운트 dlog | -> normalizeDate`

`src/App.tsx | normalizeDate(raw, format) | function | 다양한 날짜 포맷(YYYY/MM/DD 등) 감지 → YYYY-MM-DD로 정규화. 2자리 연도 보정 | -`

`src/App.tsx | runCsvUpload | function | pushHistory + appData에 변환행 append → runExport(silent)로 시트 즉시 업로드. 성공/실패 모두 csvPhase=uploaded | -> pushHistory, runExport`

`src/App.tsx | copyDebugLogs | function | debugLogsRef.current.join("\n")을 navigator.clipboard.writeText로 복사. 디버그 [전체 복사] 버튼에서 호출 | -`

`src/App.tsx | csv-modal-overlay (JSX) | modal | 대상 탭 select + AI 정보 / CSV 드롭존 + [파일 선택] / 미리보기 표 / 매핑 표시 / 실패 / 성공 / 푸터 [취소][AI로 분석][시트에 업로드] | -`

`src/App.tsx | settingsTab + settings-tabs UI | state+JSX | 설정 패널을 [시트 설정] / [구글 시트 연결] 두 탭으로 분리. 시트 탭=치지직 링크/작업상태/담당자 등록/방송 감지/되살리기 설정/히스토리, 연결 탭=상단 도움말 배너 + Sheets URL/Service Account JSON/연결 테스트 | -`

`src/App.tsx | undoStack / redoStack / maxUndoSize / lastEditCellRef | state+ref | undo/redo 양방향 스택. 기본 10단계, 설정에서 5~50단계 슬라이더 조정. 같은 (tab,row,col,role) 셀 연속 편집은 lastEditCellRef로 묶어 1단계로 처리 | -`

`src/App.tsx | pushHistory(reason, cellGroupKey?) | function | 셀 단위 묶음 push. cellGroupKey가 직전과 같으면 추가 push 안 함, 다르면 새 entry 생성 + redoStack 비움 + maxUndoSize 초과분 trim | -> cloneState`

`src/App.tsx | undoLast / redoLast | function | undoStack pop → 현재 상태를 redoStack에 push → 적용. redoLast는 그 반대. lastEditCellRef는 null로 리셋 | -> cloneState`

`src/App.tsx | useEffect (Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y 단축키) | hook | document keydown 리스너. INPUT/TEXTAREA/contenteditable 안에서는 OS 기본 동작 위임 (셀 편집 중 한 글자 단위 OS undo 보존), 그 외에는 앱 단위 undo/redo 호출 | -> undoLast/redoLast`

`src/App.tsx | useEffect (maxUndoSize 변경) | hook | 슬라이더로 줄였을 때 기존 undo/redo 스택을 새 한도로 즉시 trim | -`

`src/App.tsx | updateCell pushHistory 통합 | function | 모든 셀 편집(updateCell)이 cellGroupKey와 함께 pushHistory 호출. 같은 셀 연속 입력은 단일 entry, 다른 셀로 이동하면 새 entry | -> pushHistory`

`src/styles.css | .settings-header / .settings-close-btn / .settings-tabs / .settings-tab / .connection-help-banner / .connection-help-btn | stylesheet | 설정 패널 헤더 + 우측 닫기 버튼 + 탭 스위치 + 연결 탭 상단 도움말 배너 (그라디언트 + 외부 링크 버튼) | -`

`src/App.tsx | useEffect (외부 클릭 닫기) | hook | 설정 패널/상태 드롭다운/타입 메뉴/담당자 메뉴를 바깥 클릭 시 닫음 | -`

`src/App.tsx | col-drag-handle | UI button | 헤더 좌측 hover 시 표시되는 열 순서 드래그 핸들 (input 텍스트 선택과 충돌 회피) | -> moveColumn`

`electron/main.js | initSheetsAuth | function | Service Account JSON으로 GoogleAuth + sheetsClient 생성. client_email도 파싱해 보관 | -> googleapis`

`electron/main.js | sheets-test-connection (IPC) | handler | spreadsheets.get으로 시트 메타데이터 조회 → 권한 검증 | -> sheetsClient`

`electron/main.js | sheets-import (IPC) | handler | 시트 → RowItem 역직렬화. headers[].shared 로 paired 모드 판별, shared 컬럼이 모두 비어있는 행은 직전 RowItem 의 editor 로 합치고, 첫 행은 thumbnailer 로 적재 (다시보기 등 비-paired 탭은 단일 행 모드) | -> sheetsClient`

`electron/main.js | sheets-export (IPC) | handler | RowItem → 시트 직렬화. paired 탭은 RowItem 1개를 시트 2행(썸네일러/영상편집자)으로 펼치고, shared 컬럼은 1행에만 채움. 업로드 전 values.clear 로 잔여 행 제거 | -> sheetsClient`

`electron/preload.js | sheetsTestConnection | bridge | 렌더러 → main의 sheets-test-connection 호출 | -`

`public/help/ | *.gif | static asset | Service Account 도움말 카드 GIF (없으면 placeholder 자동 표시) | -`

`src/styles.css | app-shell/topbar/tabbar/table styles | stylesheet | White + Soft Pink 기반 기본 UI 스타일 | -`

`src/styles.css | .assignee-pill/.assignee-dropdown | stylesheet | 담당자 셀 칩 + 그룹화 드롭다운 | -`

`src/styles.css | .staff-config/.staff-chip | stylesheet | 설정 패널의 편집자 등록 영역 + 역할별 칩 | -`

`src/styles.css | .help-card-step/.help-step-tabs/.help-step-gif | stylesheet | 8단계 step 도움말 카드 + GIF placeholder | -`

`src/styles.css | .sa-dropzone/.sa-email-row/.sa-test-btn | stylesheet | Service Account JSON 드래그&드롭 + 이메일 복사 + 연결 테스트 UI | -`

`src/styles.css | .col-drag-handle | stylesheet | 헤더 hover 시 표시되는 열 순서 드래그 핸들 | -`

`package.json | build (electron-builder) | config | NSIS 인스톨러 빌드 설정. oneClick=false / perMachine=false / allowToChangeInstallationDirectory=true. include=build/installer.nsh. 산출물 release/ | -> electron-builder`

`build/installer.nsh | NSIS 커스텀 스크립트 | static | preInit 으로 기본 설치 경로를 $DOCUMENTS\\Inel Work Scheduler 로 강제. customPageAfterChangeDir 에서 [바탕화면 바로가기] / [윈도우 시작 시 자동실행] 체크박스를 nsDialogs 로 추가. customInstall 에서 선택값 적용, customUnInstall 에서 정리 | -`

`electron/main.js | autostart-get / autostart-set (IPC) | handler | app.getLoginItemSettings / app.setLoginItemSettings 래퍼. dev 환경에서는 적용 효과가 없으므로 warning 반환 | -> app.setLoginItemSettings`

`electron/preload.js | autostartGet / autostartSet | bridge | 렌더러 → main 의 autostart-get/set 호출 | -`

`src/App.tsx | autoStartEnabled / toggleAutoStart | state+function | '기타 설정' 탭의 자동실행 토글. 시작 시 autostartGet 으로 현재 상태 조회, 토글 시 autostartSet 호출 | -> autostartGet/Set`

`src/App.tsx | settingsTab='etc' panel | UI section | 기타 설정 탭. (1) 자동실행 토글 (2) 편집자/썸네일러별 인스톨러 빌드 placeholder UI (disabled, 2차 배포 예정) (3) _tokens 안내 카드 | -> staffList, toggleAutoStart`

`src/styles.css | .etc-card / .switch / .staff-installer-row | stylesheet | 기타 설정 탭 카드 + iOS 스타일 토글 스위치 + 담당자별 인스톨러 행 | -`

---

## 추가 항목 (phase1 마무리 ~ 1.0.0)

> 1차 배포(1.0.0) 직전까지 누적된 변경 모음. 위 본문 항목과 일관된 한 줄 표 형식 유지.

### 영구 저장 (localStorage)

`src/App.tsx | loadInitialRows | function | 앱 마운트 시 localStorage("inel.rowsByTab.v1") 에서 행 데이터 복원. 없으면 initialRows fallback. appData 의 useState lazy initializer 로 사용해 동기 로드 | -`

`src/App.tsx | useEffect (rowsByTab 자동 저장) | hook | appData.rowsByTab 변경 시 500ms 디바운스 후 localStorage("inel.rowsByTab.v1") 저장. 시트 미연결도 로컬 영구화 | -`

`src/App.tsx | useEffect (schemaByTab 영구 저장) | hook | appData.schemaByTab 변경 시 localStorage("inel.schemaByTab.v1") 저장. 시작 시 default schema 와 머지 로드 (새 컬럼 도입에도 호환) | -`

`src/App.tsx | sortOrderByTab / SortOrder | state+type | 탭별 행 정렬 순서 ("desc"|"asc"). 기본 "desc". localStorage("inel.sortOrderByTab.v1") 영구 저장. filteredData useMemo 가 broadcastDate → broadcastStartTime 순으로 안정 정렬, 빈 날짜는 항상 맨 끝 | -`

`src/App.tsx | toolbar-row + sort-select | UI | 월 페이저 우측에 "최신순/이전순" 드롭다운(.sort-select). margin-left:auto 로 우측 정렬. title 에 "앱 표시 전용. 시트는 항상 오름차순 고정" 안내 | -> sortOrderByTab`

### 방송감지 영구 / 자동 재개

`src/App.tsx | wasDetectingRef / autoResumeDoneRef | useRef | localStorage 의 inel.isDetecting.v1 값을 보관 + 앱 시작 시 1회 자동 재개 가드 | -`

`src/App.tsx | useEffect (isDetecting 영구 저장 / 자동 재개) | hook | (1) isDetecting 변경 시 localStorage 저장. (2) 마운트 시 wasDetectingRef && chzzkLink 면 startChzzkPolling 1회 호출해 감지 자동 재개. autoResumeDoneRef 로 중복 방지 | -> startChzzkPolling`

### 방송제목 타임라인 누적 (다시보기)

`src/App.tsx | appendTitleTimeline | useCallback | fullReplay 활성 row.values.videoTitle 에 "HH:MM:SS - <제목>" entry 누적. 직전 entry 와 같으면 append 안 함 (중복 방지). schedulePatchActiveRow 호출로 즉시 시트 patch | -> schedulePatchActiveRow`

`src/App.tsx | firstTitleRecorded (ref) | useRef | LIVE ON 첫 감지 시 한 번만 첫 제목을 timeline 에 기록. LIVE OFF / 토글 시 리셋 | -`

`src/App.tsx | onChzzkTitleChange 핸들러 | logic | 매 title 변경마다 appendTitleTimeline 호출. ensureDetectRow 활성 row 가 없으면 무시 | -> appendTitleTimeline`

`src/App.tsx | fullReplay schema 의 videoTitle | const update | label "영상제목 타임라인", type "text", width 320. shorts/longform 의 videoTitle 은 일반 단일값 유지 | -`

`src/App.tsx | renderCell (timeline-cell 분기) | logic | activeTab==="fullReplay" && (column.key==="categoryTimeline" || column.key==="videoTitle") 일 때 read-only div.timeline-cell 로 렌더. 줄바꿈마다 .timeline-entry div | -`

`src/styles.css | .timeline-cell / .timeline-entry | stylesheet | 다시보기 timeline 컬럼의 read-only multi-line 표시 (배경 약간 어둡고 cursor:default) | -`

### 카테고리 타임라인 즉시 patch (t12-a, t12-b 완성)

`src/App.tsx | appendCategoryTimeline | useCallback | fullReplay 활성 row.values.categoryTimeline 에 "HH:MM:SS - <카테고리>" entry 누적. 직전 entry 와 같으면 append 안 함. schedulePatchActiveRow 호출로 즉시 시트 patch. 신규 카테고리는 categoriesAddUser 자동 등록(별도 분기) | -> schedulePatchActiveRow, categoriesAddUser`

### 시트 / Google Sheets 추가

`electron/main.js | sheets-export 안정 정렬 | logic | export 직전 rows 를 broadcastDate 오름차순, 같으면 broadcastStartTime, 같으면 원래 입력 순으로 안정 정렬. 빈 날짜는 항상 맨 끝. 시트의 시간 흐름을 사람이 읽기 쉽게 고정 | -`

`electron/main.js | sheets-patch-row USER_ENTERED | option | update/append 시 valueInputOption="USER_ENTERED" 로 호출해 Google Sheets 가 날짜를 진짜 날짜로 인식 (46144 같은 시리얼 숫자 표시 방지) | -`

`src/App.tsx | handleCopySheetLink | async function | 시트 링크를 navigator.clipboard.writeText 로 복사 + sheetsStatus 짧게 갱신. sheetLink 비어 있으면 disabled | -> navigator.clipboard`

`src/App.tsx | icon-button (copy sheet link) | UI button | "구글시트 업로드" 우측의 SVG 아이콘 버튼. .icon-button 정사각 + 중앙 정렬 | -> handleCopySheetLink`

`src/App.tsx | settings-tab 라벨 "구글 시트" | UI const | 기존 "구글 시트 연결" → "구글 시트" 단축. settingsTab key 는 "connection" 그대로 유지 | -`

### 다시보기 방송시작시간 (broadcastStartTime)

`src/App.tsx | fullReplay schema 의 broadcastStartTime | const | type "text", HH:MM:SS KST 표시. ensureDetectRow 시 Chzzk openDate 를 KST 변환해 초기값. 같은 세션 안에서는 값이 안 변하므로 row 검색 키로 안전 사용 | -`

`electron/main.js | chzzk-status 의 broadcastStartTime 계산 | logic | poll 응답의 openDate (KST 가정) 를 파싱해 HH:MM:SS 문자열 추출. polling 시작 시각 fallback 안 씀 (단절 후 재개에도 같은 시각 유지) | -`

### Chzzk payload 키화 / 에러 정보 강화

`electron/main.js | chzzk-error 에 stack 동봉 | logic | webContents.send("chzzk-error", { message, stack: err.stack }) 형태로 디버그 추적성 향상 | -`

`electron/main.js | chzzk-title-change payload (categoryDisplay 사용) | fix | 과거 미정의 category 변수 참조로 인한 무한 emit 버그 해결. 비교는 lastCategory.categoryId, 표시값은 categoryDisplay 로 분리 | -`

### 앱 삭제 기능 (Self-uninstall)

`electron/main.js | app-uninstall (IPC) | handler | win32 & packaged 환경에서만 동작. process.execPath 의 dirname 에 있는 "Uninstall Inel Work Scheduler.exe" 를 spawn(["/S","--force-run"], { detached, stdio:ignore, windowsHide }) + child.unref. 600ms 뒤 app.quit() 로 파일 잠금 회피 | -> child_process.spawn`

`electron/preload.js | uninstallApp | bridge | renderer → main "app-uninstall" IPC 호출 래퍼 | -`

`src/App.tsx | uninstallModalOpen / uninstallConfirmText / uninstalling | state | 앱 삭제 모달 가시성 / 확인 문구 입력값 / 진행중 플래그. UNINSTALL_CONFIRM_PHRASE = "이늘 스케쥴러 삭제합니다" 정확히 입력해야 [삭제 진행] 활성화 | -`

`src/App.tsx | settingsTab="etc" 안의 .etc-danger-card | UI | "기타 설정" 탭 최하단의 빨간 위험 카드. [앱 삭제하기] 빨간 버튼 → 확인 모달 오픈 | -> uninstallApp`

`src/App.tsx | uninstall-modal-overlay | UI modal | 경고 메시지 + 입력 필드 + [취소][삭제 진행]. 확인 문구 정확 일치 시에만 [삭제 진행] enabled. 클릭 시 electronAPI.uninstallApp + setUninstalling(true) | -> uninstallApp`

`src/styles.css | .etc-danger-card / .etc-danger-btn / .uninstall-modal-* | stylesheet | 빨간 danger 카드 + 모달 (overlay, warning, confirm-phrase input, confirm-btn) | -`

### AI 연결 / CSV 가져오기 기능 잠금 (테스트 중)

`src/App.tsx | ai-locked-banner + fieldset.ai-fieldset-locked | UI | "AI 연결" 탭 진입 시 노란 "⚠ 기능 테스트 중" 배너 + 아래 모든 컨트롤을 <fieldset disabled> 로 한 번에 잠금. pointer-events:none + opacity 0.55 로 시각적 비활성. provider/key/model select + key visibility / refresh / guide 모두 영향 | -`

`src/App.tsx | "CSV 가져오기 (AI)" 상단바 버튼 | UI | disabled 고정 + title="기능 테스트 중 — 다음 업데이트에서 활성화됩니다." | -`

`src/styles.css | .ai-locked-banner / .ai-fieldset-locked | stylesheet | 잠금 배너 색상 (warm yellow) + fieldset opacity / grayscale / pointer-events 처리 | -`

### NSIS / Installer 보강

`build/installer.nsh | !ifndef BUILD_UNINSTALLER 가드 | nsis | installer 전용 Var / Function / Page 정의가 uninstaller 빌드에 노출되면 NSIS warning 6010 (electron-builder 가 error 로 취급) 발생. 그래서 customUnInstall 만 가드 밖에 두고 나머지는 모두 안에 둠 | -`

`build/installer.nsh | customUnInstall RMDir 안전망 | nsis | electron-builder 의 deleteAppDataOnUninstall:true 만으로는 $LOCALAPPDATA Chromium 캐시 잔존이 발생하므로 $APPDATA, $LOCALAPPDATA, $LOCALAPPDATA\${APP_PACKAGE_NAME}-updater 를 RMDir /r 로 강제 정리. 빈 $INSTDIR 도 RMDir | -`

`build/installer.nsh | PendingAutoStart 핸드오프 | nsis+main | NSIS 가 Run 키를 직접 안 쓰고 HKCU\Software\${PRODUCT_NAME}\PendingAutoStart 에 "0"/"1" 만 적음. main.js 가 첫 실행 시 이를 읽어 app.setLoginItemSettings 호출 후 키 삭제. (Electron 의 인용 포맷 차이로 직접 Run 키를 만들면 getLoginItemSettings 가 OFF 로 인식) | -> app.setLoginItemSettings`

### .cursor 하네스

`.cursor/rules/00-project-context.mdc | alwaysApply rule | 매 세션 자동 로드. 스택 / 탭 구조 / 데이터 흐름 / 브랜치 전략 / 영구 저장 위치 / 보안 모델 핵심 요약 | -`

`.cursor/rules/10-typescript-conventions.mdc | globs rule | src/**/*.{ts,tsx}, electron/**/*.js 편집 시 로드. IPC 4단계 동기화 의무 / strict TS / React 훅 / 상태 mutate 금지 | -`

`.cursor/rules/20-deny-dangerous.mdc | alwaysApply rule | force push / npm install / package.json build / installer.nsh / app-uninstall 핸들러 등 위험 작업 시 사용자 동의 강제 | -`

`.cursor/rules/30-secrets-policy.mdc | alwaysApply rule | Service Account / AI API Key / Chzzk 자격증명 취급. 마스킹 요청 / 노출 사고 절차 | -`

`.cursor/rules/40-i18n.mdc | alwaysApply rule | 한국어 UI / 한국어 응답 정책. 식별자는 영어, 라벨은 한국어 | -`

`.cursor/rules/dev-rule.mdc | alwaysApply rule | (기존) docs/code_flow / git / reference 정책 | -`

`AGENTS.md | directory rule | 루트 큰 그림 + 디렉토리 지도 + IPC 카테고리 + 데이터 흐름 다이어그램 + 브랜치 전략 | -`

`electron/AGENTS.md | directory rule | main/preload 컨벤션 + IPC 4단계 절차 + Sheets/Chzzk 호출 규약 + NSIS 핸드오프 | -`

`src/AGENTS.md | directory rule | App.tsx 단일파일 정책 + 상태/localStorage 카탈로그 + IPC 호출 패턴 + 새 기능 추가 흐름 | -`

`build/AGENTS.md | directory rule | NSIS 매크로 구조 + !ifndef BUILD_UNINSTALLER 함정 + 빌드 실패 패턴 + 업그레이드 정책 | -`

`docs/AGENTS.md | directory rule | code_flow.md 갱신 의무 + plans/ 운영 + public/help/ HTML 가이드 관리 | -`

`.cursor/skills/sheets-sync/SKILL.md | on-demand skill | Sheets 동기화 작업 시 자동 로드. 헤더 정렬 보존 / 2-row 구조 / patch-row 흐름 / 편집자별 SA 분리 보안 모델 | -`

`.cursor/skills/chzzk-detection/SKILL.md | on-demand skill | 방송감지 작업 시 자동 로드. 1세션=1row 정책 / ensureDetectRow / appendTimeline / 단절 후 재개 / 즉시 patch | -`

`.cursorignore | file | release, reference, node_modules, secrets 패턴 차단. .env, *-service-account.json 등 자격증명 우발 노출 방지 | -`

`.cursorindexignore | file | public/help/gifs, src/assets, chzzk-categories.seed.json 등은 인덱싱(RAG)만 제외 - 명시 Read 는 허용 | -`

---

## 추가 항목 (phase2 - edition 분기 시스템 도입)

> 편집자 / 썸네일러 인스톨러를 위한 role(edition) 시점 분기. 빌드 시점 상수로 dead-code 제거 보장.

### 빌드 타임 상수

`vite.config.ts | __IWS_EDITION__ define | config | process.env.IWS_EDITION ("admin" | "editor" | "thumbnailer", 기본 admin) 를 빌드 시 JSON 문자열로 inline. 잘못된 값이면 즉시 throw. | -> process.env`

`src/App.tsx | declare const __IWS_EDITION__ | type | TypeScript 가 인식하도록 ambient declaration. Edition 타입과 BUILD_EDITION const 도 함께 정의 | -`

`src/App.tsx | IS_ADMIN (모듈 const) | bool | __IWS_EDITION__ === "admin" 의 boolean literal. 모듈 최상위라 Rollup/esbuild 가 inline → JSX 의 `{IS_ADMIN && (...)}` 가 editor/thumbnailer 빌드에서 통째로 dead-code 제거 | -`

`src/App.tsx | LABEL_SYNC_DOWNLOAD / UPLOAD / DOWNLOADING / UPLOADING | 모듈 const | "구글시트 다운로드" ↔ "일정 새로고침" 같은 라벨을 모듈 const 로 분기 → 양쪽 문자열이 산출물에 같이 남는 ternary 함정을 회피 | -`

### 런타임 edition (dev 토글)

`src/App.tsx | devEdition / setDevEdition | state | dev 모드에서만 admin/editor/thumbnailer 시점 즉시 전환. localStorage("inel.devEdition.v1") 영구 저장. production 빌드에는 BUILD_EDITION 그대로 사용 (import.meta.env.DEV 조건으로 코드 자체가 dead) | -`

`src/App.tsx | edition / isAdmin / isStaff | const | edition = DEV ? devEdition : BUILD_EDITION. isAdmin = IS_ADMIN && edition === "admin" (모듈 상수 곱해서 dead-code 가능성 ↑). JSX 조건은 `{IS_ADMIN && isAdmin && (...)}` 형태로 빌드 + runtime 두 단계 가드 | -`

`src/App.tsx | settingsTab 보정 useEffect | hook | staff(editor/thumbnailer) 시점일 때 settingsTab 이 admin 전용 탭(sheet/connection/ai)이면 자동 "etc" 로 보정. dev 시점 토글 직후 빈 패널 표시 방지 | -`

### 디버그 패널 시점 드롭다운

`src/App.tsx | .debug-edition-row | UI | 디버그 패널 헤더 아래 dev 전용 행. admin/editor/thumbnailer 드롭다운 + 현재 BUILD_EDITION 표시. production 빌드에선 import.meta.env.DEV === false 라 코드 자체가 dead | -> devEdition`

`src/styles.css | .debug-edition-row | stylesheet | 다크 톤 행 (배경 #1f2937, 좌측 라벨/우측 BUILD = 힌트) | -`

### admin only 가드 적용 위치

`src/App.tsx | 상단바 admin only | UI | 시트 링크 복사 버튼, CSV 가져오기 (AI) 버튼, 디버그 토글 모두 {IS_ADMIN && isAdmin && (...)} 가드. editor 빌드 산출물에서 코드 자체 제거 | -`

`src/App.tsx | 설정 패널 admin only | UI | 설정 탭 "시트 설정" / "구글 시트" / "AI 연결" 탭 버튼 + 본문 패널 모두 IS_ADMIN gate. staff 시점은 "기타 설정" 한 탭만 노출 | -`

`src/App.tsx | 디버그 패널 + CSV 모달 admin only | UI | aside.debug-panel 과 .csv-modal-overlay 둘 다 {IS_ADMIN && (...)} 로 감싸 dead-code 제거. CSV 모달은 진입점 버튼이 admin only 라도 코드 자체 제거를 위해 별도 가드 필요 | -`

`src/App.tsx | app-shell with-debug 클래스 가드 | UI | className 도 IS_ADMIN && isAdmin && showDebugPanel 로 합성. editor 빌드는 항상 no-debug → 레이아웃 정합 | -`

### 빌드 산출물 검증 (1차 측정)

`(검증) admin 빌드 | 296.07 kB | admin 문자열 6 (UI), staff 문자열 0 | -`

`(검증) editor 빌드 | 269.88 kB | admin UI 문자열 0, 함수 body dlog 잔존 2 (Service Account hint, 호출 안 됨), staff 문자열 4 (UI) | -`

`(검증) thumbnailer 빌드 | 269.88 kB | editor 빌드와 동일 패턴 | -`

> 차이 ~26 kB / 9%. admin 전용 UI/JSX 가 staff 빌드 산출물에 없음을 확인. 함수 body 내부 일부 dlog 문자열은 향후 admin 전용 함수 모듈 분리로 추가 제거 가능 (현재는 호출 경로 자체가 없어 노출 위험 없음).

### 라벨 매핑 (admin ↔ staff)

| 위치 | admin | staff |
|---|---|---|
| 상단바 다운로드 | 구글시트 다운로드 | 일정 새로고침 |
| 상단바 업로드 | 구글시트 업로드 | 변경사항 저장 |
| 동기화 상태 (downloading) | 시트 내려받는 중 | 새로고침 중 |
| 동기화 상태 (uploading) | 시트 올리는 중 | 저장 중 |

---

## 추가 항목 (phase2 - 인스톨러 빌드 분기)

> admin / editor / thumbnailer 별로 다른 productName · appId · 산출물 파일명 · 시작메뉴 shortcut 으로 NSIS 빌드. 같은 머신에 3개 동시 설치 가능.

`scripts/build-edition.mjs | build-edition | node script | IWS_EDITION 환경변수(admin/editor/thumbnailer, 기본 admin) 기반으로 package.json 의 build 섹션을 override 한 config 객체를 만들어 electron-builder Node API(build())로 Windows NSIS 빌드 실행. NSIS 의 ${PRODUCT_NAME} 매크로는 productName 을 그대로 받아쓰므로 설치 경로 / 레지스트리 / AppData 가 edition 별로 자연 분리됨 — installer.nsh 별도 수정 불필요 | -> electron-builder Node API, package.json`

`package.json | scripts.dist:admin / dist:editor / dist:thumbnailer | npm script | cross-env IWS_EDITION=<edition> npm run build:web && cross-env IWS_EDITION=<edition> node scripts/build-edition.mjs. 두 단계 모두 환경변수 주입 필수 (vite + electron-builder 단계 각각). 기존 npm run dist 는 dist:admin 으로 alias | -> scripts/build-edition.mjs`

### edition 별 빌드 메타데이터

| edition | productName | appId | artifactName | shortcutName |
|---|---|---|---|---|
| admin | Inel Work Scheduler | com.inel.scheduler | Inel Work Scheduler-Setup-${version}.${ext} | Inel Work Scheduler |
| editor | Inel Scheduler Editor | com.inel.scheduler.editor | Inel Scheduler-Editor-Setup-${version}.${ext} | 이늘 스케쥴러 (편집자) |
| thumbnailer | Inel Scheduler Thumbnailer | com.inel.scheduler.thumbnailer | Inel Scheduler-Thumbnailer-Setup-${version}.${ext} | 이늘 스케쥴러 (썸네일러) |

> productName / artifactName 은 폴더명·레지스트리·파일시스템 호환 위해 영문. shortcutName 만 한글 (시작메뉴 가시성).

### 자동 분리되는 경로 (NSIS ${PRODUCT_NAME} 활용)

- 설치 경로: `$DOCUMENTS\${PRODUCT_NAME}` → admin/editor/thumbnailer 별 다른 폴더
- 레지스트리: `HKCU\Software\${PRODUCT_NAME}` 분리
- AppData: `$APPDATA\${PRODUCT_NAME}` / `$LOCALAPPDATA\${PRODUCT_NAME}` 분리
- 바탕화면 shortcut, customUnInstall 정리 경로 모두 분리

### 1차 빌드 검증

`(검증) admin .exe | 100.10 MB | Inel Work Scheduler-Setup-1.0.0.exe | -`
`(검증) editor .exe | 100.09 MB | Inel Scheduler-Editor-Setup-1.0.0.exe | -`
`(검증) thumbnailer .exe | 100.09 MB | Inel Scheduler-Thumbnailer-Setup-1.0.0.exe | -`

> 크기는 거의 동일 (asar 안의 JS 차이 26 kB 는 .exe 100 MB 안에서 미미). 핵심은 appId 분리로 같은 머신에 3개 공존 설치 가능, 그리고 각자 다른 UI 빌드 (admin only UI 제거된 staff 빌드) 가 박혔다는 점.

---

## 추가 항목 (phase2 - 임베드 메타 + 토큰 검증 + 빌드 다이얼로그 + 난독화)

> 편집자/썸네일러용 zero-setup 인스톨러 완성. 관리자 UI에서 빌드 → 편집자가 받아 설치 → 자동 인증 + 토큰 검증 → 작업 가능. 권한 회수는 `_tokens` 시트 status 변경.

### Phase A — 임베드 메타데이터

`vite.config.ts | IWS_NAME / ROLE / TOKEN / SHEET_URL / SA_KEY_B64 define 5종 | config | 각각 string literal 로 코드에 inline. admin 빌드는 모두 빈 문자열로 강제. SA JSON 은 base64 임베드 → main 이 디코딩해 userData 에 저장 | -> process.env`

`src/App.tsx | EMBED { name, role, token, sheetUrl, hasSaKey } | const | __IWS_*__ 매크로를 모은 객체. hasSaKey 는 SA_KEY_B64 길이 > 0 검사로 boolean 화. UI 라벨 / 토큰 검증 / 자동 셋업 트리거에 활용 | -`

`src/App.tsx | sheetLink useState lazy init | hook | EMBED.sheetUrl 이 있으면 초기값으로 주입 → 편집자는 시트 URL 입력 단계 없이 바로 연결 | -`

`src/App.tsx | embedSetupDoneRef + 셋업 useEffect | hook+ref | 마운트 시 hasSaKey && !IS_ADMIN 이면 IPC setup-embed-sa 한 번 호출 → 응답으로 serviceAccountPath / clientEmail 설정 + 곧바로 verifyEmbedToken("startup") | -> setupEmbedSa`

`electron/main.js | setup-embed-sa (IPC) | handler | saKeyB64 → JSON 검증 → userData/google-credentials.json 으로 쓰기 (이미 있으면 skip) → initSheetsAuth 호출. clientEmail 반환 | -> Buffer.from(b64), initSheetsAuth`

`electron/preload.js | setupEmbedSa | bridge | renderer → main "setup-embed-sa" 호출 래퍼 | -`

### Phase C — 토큰 검증 + 잠금 화면

`electron/main.js | ensureTokensSheet / readTokensRows / generateToken | helper | _tokens 시트 (헤더: name|role|token|issuedAt|status|lastSeen) 자동 생성/보충 + 행 파싱 + crypto.randomBytes 토큰 발급. 모두 spreadsheetId 인자 받는 비공개 함수 | -> crypto, sheetsClient`

`electron/main.js | tokens-verify (IPC) | handler | sheetUrl + name(NFC 정규화) + role + token 으로 _tokens 시트 첫 매칭 행 검색. status==="active" 면 valid=true 반환 + lastSeen 갱신. 그 외 valid=false + status 반환 | -> ensureTokensSheet, readTokensRows`

`electron/main.js | tokens-issue (IPC) | handler | 같은 (name, role) 의 기존 행이 있으면 새 토큰으로 update (rotate), 없으면 append. 결과 토큰 반환 | -> ensureTokensSheet, readTokensRows, generateToken`

`electron/preload.js | tokensVerify / tokensIssue | bridge | renderer → main IPC 호출 래퍼 | -`

`src/App.tsx | lockState ("ok"|"verifying"|"locked") + lockReason | state | staff 빌드 prod 의 마운트 직후 "verifying" → 검증 결과에 따라 ok / locked. admin 과 dev 는 무조건 "ok" 즉시 통과 | -`

`src/App.tsx | verifyEmbedToken (useCallback) | function | EMBED.token 으로 tokens-verify IPC 호출. startup 시점이면 통신 실패도 잠금 처리, periodic 은 톨러런스 (일시 장애 무시). valid=true 면 lockState="ok", 아니면 reason 메시지 분기 | -> tokensVerify`

`src/App.tsx | 주기적 재검증 useEffect | hook | staff prod 빌드 한정 10분 간격 setInterval 로 verifyEmbedToken("periodic"). 권한 회수 시 자동 잠금 | -> verifyEmbedToken`

`src/App.tsx | .lock-overlay / .lock-card 잠금 화면 렌더 | UI | !IS_ADMIN && lockState !== "ok" 면 본문 대신 잠금 화면 표시. 아이콘 + 사용자 이름 + 사유 + [다시 시도] 버튼 | -`

`src/styles.css | .lock-overlay / .lock-card / .lock-retry-btn 등 | stylesheet | 핑크 그라데이션 배경 + 흰 카드 + 핑크 강조 버튼 | -`

### Phase B — 관리자 인스톨러 빌드 다이얼로그

`electron/main.js | pick-output-dir (IPC) | handler | dialog.showOpenDialog (openDirectory + createDirectory) 으로 인스톨러 출력 폴더 선택. defaultPath 옵션 | -> dialog`

`electron/main.js | build-editor-installer (IPC) | handler | 핵심. (1) _tokens 토큰 발급 (2) SA JSON 읽어 base64 (3) spawn("npm.cmd", ["run", "dist:editor"|"dist:thumbnailer"]) + env 로 IWS_NAME/ROLE/TOKEN/SHEET_URL/SA_KEY_B64 forward (4) release/Inel Scheduler-Role-Setup-*.exe + .blockmap 을 outputDir 로 복사. 매 단계 webContents.send("build-installer-log", line) emit | -> spawn, fs.copyFileSync`

`electron/preload.js | pickOutputDir / buildEditorInstaller / onBuildInstallerLog | bridges | onBuildInstallerLog 는 build-installer-log 이벤트 구독 + unsubscribe 콜백 반환 (cleanup 패턴) | -`

`src/App.tsx | installerModalOpen / installerTargetStaffId / installerOutputDir / installerBuilding / installerLogs / installerResult | state | 빌드 모달 6종 상태. 빌드 중에는 모든 입력 disabled, ESC/배경 클릭으로 닫기 차단 | -`

`src/App.tsx | openInstallerModal / handlePickInstallerDir / handleRunInstallerBuild / closeInstallerModal | function | 모달 열기 - 폴더 선택 IPC - 빌드 IPC + 실시간 로그 구독 - 닫기. 빌드 중에는 close 차단 | -> pickOutputDir, buildEditorInstaller, onBuildInstallerLog`

`src/App.tsx | "기타 설정 > 편집자/썸네일러 인스톨러 빌드" 카드 활성화 | UI | 기존 disabled placeholder 제거. staffList 각 항목에 [인스톨러 빌드] 버튼 + onClick={openInstallerModal(s.id)}. sheetLink || serviceAccountPath 미설정 시 disabled + tooltip 안내 | -> openInstallerModal`

`src/App.tsx | .installer-modal-overlay / .installer-modal 등 | UI modal | 편집자 chip + 출력 폴더 선택 + 시트 URL readonly 표시 + 실시간 빌드 로그 (까만 콘솔 박스) + 결과 카드 (성공/실패) + 푸터 [취소][빌드 시작] | -`

`src/styles.css | .installer-modal-* 일괄 | stylesheet | 모달 overlay/header/body/footer + 폴더 pick row + 로그 박스 (#111827 어두운 톤) + 성공/실패 result 카드 | -`

### Phase D — 경량 난독화 (staff 빌드 한정)

`package.json devDeps | vite-plugin-javascript-obfuscator | npm dep | v3.1.0. javascript-obfuscator 의 vite plugin 래퍼. apply: "build" 시점에 stringArray + identifier mangling 적용 | -`

`vite.config.ts | obfuscator plugin (staff 한정) | config | !IS_ADMIN 일 때만 plugins 에 push. stringArray + base64 encoding (한글 라벨, SA_KEY_B64, sheetUrl 등이 grep 으로 안 잡힘). controlFlowFlattening / deadCodeInjection / debugProtection 은 끔 (빌드 시간 / 사용자 PC 부담). identifierNamesGenerator: "mangled" | -> vite-plugin-javascript-obfuscator`

### 종합 빌드 검증 (Phase A+C+B+D 통합)

`(검증) admin index.js | 300.12 kB | "구글시트 다운로드" 1 (UI), "일정 새로고침" 0, "디버그 패널" 4 (UI), 난독화 X | -`
`(검증) editor index.js | 296.40 kB | "구글시트 다운로드" 0, "일정 새로고침" 0 (난독화로 base64 인코딩), "Service Account" 1 (함수 body dlog), "__IWS" identifier 0 (모두 inline) | -`
`(검증) thumbnailer .exe | 100.11 MB | editor 와 동일 패턴 | -`

> editor 빌드는 base64 stringArray 로 "일정 새로고침" 도 grep 안 잡힘. 호기심 추출 차단 효과 정상. compact + mangled identifier 로 함수명 / 변수명 무의미 글자로 변환.

### 최종 운영 흐름

```
[관리자]
  설정 > 기타 설정 > 편집자/썸네일러 인스톨러 빌드 카드
    └ "OOO 인스톨러 빌드" 클릭
        └ 모달:
            • 출력 폴더 선택 (release/editors/OOO/ 권장)
            • 시트 URL 자동 표시 (현재 sheetLink)
            • [빌드 시작] → IPC build-editor-installer
                • _tokens 시트에 토큰 발급/갱신
                • SA JSON base64 임베드
                • spawn npm run dist:editor (또는 dist:thumbnailer)
                • release/ 의 .exe 를 출력 폴더로 복사
            • 실시간 로그 + 결과 카드

[편집자/썸네일러]
  관리자에게서 .exe 받음 → 더블클릭 설치 (NSIS UI)
    └ 첫 실행:
        • main 이 임베드된 SA → userData/google-credentials.json 풀어 저장
        • renderer 가 setup-embed-sa IPC → 자동 인증
        • verifyEmbedToken("startup") → _tokens 시트와 대조
            ├ active → ok, 본문 표시
            └ revoked/not-found → 잠금 화면
    └ 평상시:
        • 10분 간격 주기 재검증
        • 권한 회수 (관리자가 status 를 revoked 로 바꿈) → 다음 폴링에서 자동 잠금

[관리자가 권한 영구 회수 = 시트 공유 권한 해제]
  Google Cloud Console 에서 해당 SA 의 이 시트 공유 권한 해제.
  키 자체가 살아있어도 시트 접근 자체 차단.
```

---

## 추가 항목 (phase2 - 1.1.0 배포: 안전 업그레이드 흐름)

> NSIS 인스톨러 자동 업그레이드 시 사용자 데이터 (AppData / LocalAppData / 자동실행 / 바로가기) 보존 보장.

`build/installer.nsh | !include FileFunc.nsh | nsis | GetParameters / GetOptions 매크로 사용 위해 추가 | -`

`build/installer.nsh | customUnInstall 3분기 | nsis | (a) Silent + --force-run 없음 → 업그레이드 경로, 데이터 보존. (b) Silent + --force-run 있음 → in-app [앱 삭제하기] 경로, 모든 흔적 제거. (c) Silent 아님 → 수동 uninstall (제어판/시작메뉴), 모든 흔적 제거. main.js 의 app-uninstall spawn 이 "/S --force-run" 으로 호출하므로 in-app 삭제 의도가 명확히 구분됨 | -> GetParameters, GetOptions, Silent`

`package.json | version 1.1.0 | metadata | phase2 (편집자 인스톨러 시스템 + 자동 임베드 + 토큰 검증 + 빌드 다이얼로그 + 경량 난독화 + 안전 업그레이드) minor up | -`

### 1.0.0 → 1.1.0 업그레이드 주의 (해결됨, 아래 항목으로 대체)

> 위 우려는 NSIS Rename 백업/복원 패턴과 _settings 시트 마이그레이션으로 완전히 해결되었다.

---

## 추가 항목 (phase2 - NSIS Rename + 시트 _settings 마이그레이션)

> 1.0.0 사용자의 데이터 (localStorage + AppData) 가 1.1.0 업그레이드 시 100% 보존되도록 두 레이어 추가. 이후엔 시트가 진실의 단일 소스, localStorage 는 캐시.

### NSIS Rename 안전 패턴 (작업 2)

`build/installer.nsh | customInit | nsis | 옛 1.x.x 의 $APPDATA\${PRODUCT_NAME} 이 있으면 .upgrade-backup 으로 Rename. 디렉토리 엔트리만 변경하므로 즉시 끝나고 Chromium 캐시 잠금 영향 없음. 옛 customUnInstall 의 RMDir 는 빈 폴더만 발견하여 noop. $InelUpgradeFound 변수에 1 기록 | -`

`build/installer.nsh | InelUpgradePageCreate / customPageAfterChangeDir | nsis | 옛 데이터 발견 시 "업데이트로 진행됩니다 — 모든 데이터 보존" 안내 페이지 노출. 사용자에게 마이그레이션 의도 명시 | -`

`build/installer.nsh | customInstall 복원 | nsis | $APPDATA\${PRODUCT_NAME}.upgrade-backup 이 있으면 다시 원위치로 Rename. silent uninstall 이 만든 빈 폴더가 있으면 RMDir 후 복원 | -`

### 시트 _settings 마이그레이션 (작업 1)

`electron/main.js | _settings 시트 헬퍼 | helper | SETTINGS_SHEET_NAME="_settings", 헤더 [key, value]. ensureSettingsSheet (자동 생성/헤더 보충) + readSettingsKV (시트 → { key: value }, JSON 자동 파싱) + writeSettingsKV (clear → header → rows, 전체 덮어쓰기) + patchSettingsKV (기존 행 batchUpdate, 새 key append) | -> sheetsClient`

`electron/main.js | settings-sheet-load / settings-sheet-write / settings-sheet-patch (IPC) | handler | renderer 가 _settings 시트와 양방향 동기화. load 는 kv 객체 반환, write 는 통째 덮어쓰기 (마이그레이션 1회용), patch 는 일부 key 만 update/append (자동 push 용) | -`

`electron/preload.js | settingsSheetLoad / settingsSheetWrite / settingsSheetPatch | bridges | renderer → main IPC 호출 래퍼 | -`

`src/App.tsx | settingsMigratedRef + setSettingsMigrated | useRef+fn | localStorage("inel.settingsMigrated.v1") 마이그레이션 마커. true 면 시트가 진실의 단일 소스로 간주, 이후 모든 settings 변경은 자동 시트 patch | -`

`src/App.tsx | buildSettingsPayload (useCallback) | function | 시트 _settings 로 push 할 객체 빌드. sheetLink / serviceAccountPath 는 부트스트랩 정보라 제외. chzzkLink, pollingInterval, statusOptions, staffList, maxUndoSize, schemaByTab, sortOrderByTab, isDetecting, AI 4종, userCategories 포함 | -`

`src/App.tsx | syncSettingsFromSheet (useCallback) | function | runImport 끝에 호출. settings-sheet-load 로 kv 받아서: 시트가 비어있고 마커 false 면 → 현재 localStorage 의 settings 를 시트로 통째 push (마이그레이션). 시트가 비어있지 않으면 → state 들 적용 (시트가 진실). 마커 true 설정 | -> settingsSheetLoad/Write, setSettingsMigrated`

`src/App.tsx | settings 자동 push useEffect | hook | 디바운스 1.5초. 마커 true + sheetLink 있을 때 settings payload 의 어떤 state 가 변경되면 자동으로 settingsSheetPatch 호출. 다른 PC 에서 다음 [일정 새로고침] 으로 자동 동기화 | -> settingsSheetPatch`

`src/App.tsx | saveSettings 안의 시트 patch | fn | 사용자가 [저장] 버튼 누르면 localStorage + 시트 _settings 양쪽 갱신. 마커 true + sheetLink 있을 때만 시트 patch | -> settingsSheetPatch`

### 업그레이드 흐름 (시나리오)

```
[시나리오 A — 옛 1.0.0 사용자 + 시트 연결됨]
1. 1.1.0 .exe 더블클릭
   ├ NSIS customInit: AppData 를 .upgrade-backup 으로 Rename
   ├ "업데이트로 진행" 안내 페이지
   ├ 옛 1.0.0 silent uninstall (RMDir 가 빈 폴더만 발견, noop)
   ├ 1.1.0 파일 설치
   └ NSIS customInstall: AppData 원위치 복원
2. 1.1.0 첫 실행
   ├ localStorage 그대로 (Rename 덕분에 보존됨)
   ├ 사용자가 [일정 새로고침] → runImport 끝에 syncSettingsFromSheet
   ├ 시트의 _settings 가 비어있고 마커 false 면 → settingsSheetWrite 로 통째 push
   └ 마커 true. 이후 모든 settings 변경 자동 시트 patch.

[시나리오 B — 옛 1.0.0 사용자 + 시트 미연결]
1. 1.1.0 .exe → NSIS Rename 보존 (시트 미사용이라 마이그레이션 보류)
2. 1.1.0 첫 실행 → localStorage 그대로
3. 나중에 사용자가 시트 URL + SA 등록 → [일정 새로고침] → 자동 마이그레이션 → 마커 true

[시나리오 C — 신규 사용자]
1. 1.1.0 신규 설치 → localStorage 비어있음
2. 시트 URL + SA 등록 → 시트 _settings 받음 → 마커 true. 시트가 진실

[시나리오 D — 다른 PC 에서 이미 마이그레이션됨]
1. 1.1.0 첫 실행, localStorage 있음 + 시트 _settings 도 있음
2. syncSettingsFromSheet: sheetHasData=true → 시트 kv 로 state 덮어쓰기. 마커 true
```

### 검증 빌드

`(검증) admin 1.1.0 .exe | 100.10 MB | NSIS Rename 흐름 + _settings 마이그레이션 통합 | release/Inel Work Scheduler-Setup-1.1.0.exe`

---

## 업데이트 템플릿

아래 형식으로 항목을 추가:

`파일 경로 | 이름 | 타입 | 역할 | 의존성`

예시:

`src/services/scheduleService.ts | createEditTask | function | 편집 작업 생성 | -> src/services/sheetsClient.ts`
