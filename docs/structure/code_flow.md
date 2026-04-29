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

`src/App.tsx | tableSchema | const | 탭별 기본 컬럼 정의. shorts/longform: 업로드/방송날짜/영상제목/영상카테고리(shared) + 담당자/작업시작일/납품일/편집유형/자막/원본공유/납품공유(per-role). fullReplay: 모두 shared. 편집유형/자막은 type=preset (썸네일러 기본 "-", 영상편집자 기본 "미설정") | -`

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

`src/App.tsx | HELP_STEPS | const | Service Account 설정 8단계 step UI 데이터 (제목/설명/GIF 경로) | -`

`src/App.tsx | useEffect (외부 클릭 닫기) | hook | 설정 패널/상태 드롭다운/타입 메뉴/담당자 메뉴를 바깥 클릭 시 닫음 | -`

`src/App.tsx | col-drag-handle | UI button | 헤더 좌측 hover 시 표시되는 열 순서 드래그 핸들 (input 텍스트 선택과 충돌 회피) | -> moveColumn`

`electron/main.js | initSheetsAuth | function | Service Account JSON으로 GoogleAuth + sheetsClient 생성. client_email도 파싱해 보관 | -> googleapis`

`electron/main.js | sheets-test-connection (IPC) | handler | spreadsheets.get으로 시트 메타데이터 조회 → 권한 검증 | -> sheetsClient`

`electron/preload.js | sheetsTestConnection | bridge | 렌더러 → main의 sheets-test-connection 호출 | -`

`public/help/ | *.gif | static asset | Service Account 도움말 카드 GIF (없으면 placeholder 자동 표시) | -`

`src/styles.css | app-shell/topbar/tabbar/table styles | stylesheet | White + Soft Pink 기반 기본 UI 스타일 | -`

`src/styles.css | .assignee-pill/.assignee-dropdown | stylesheet | 담당자 셀 칩 + 그룹화 드롭다운 | -`

`src/styles.css | .staff-config/.staff-chip | stylesheet | 설정 패널의 편집자 등록 영역 + 역할별 칩 | -`

`src/styles.css | .help-card-step/.help-step-tabs/.help-step-gif | stylesheet | 8단계 step 도움말 카드 + GIF placeholder | -`

`src/styles.css | .sa-dropzone/.sa-email-row/.sa-test-btn | stylesheet | Service Account JSON 드래그&드롭 + 이메일 복사 + 연결 테스트 UI | -`

`src/styles.css | .col-drag-handle | stylesheet | 헤더 hover 시 표시되는 열 순서 드래그 핸들 | -`

---

## 업데이트 템플릿

아래 형식으로 항목을 추가:

`파일 경로 | 이름 | 타입 | 역할 | 의존성`

예시:

`src/services/scheduleService.ts | createEditTask | function | 편집 작업 생성 | -> src/services/sheetsClient.ts`
