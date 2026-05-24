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

## 업데이트 템플릿

아래 형식으로 항목을 추가:

`파일 경로 | 이름 | 타입 | 역할 | 의존성`

예시:

`src/services/scheduleService.ts | createEditTask | function | 편집 작업 생성 | -> src/services/sheetsClient.ts`
