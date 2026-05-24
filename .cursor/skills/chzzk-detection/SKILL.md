---
name: chzzk-detection
description: 치지직 방송 감지 — 방송시작/카테고리/제목 폴링, 세션 연속성(1세션=1row), 타임라인 누적, 단절 후 재개. Use when the user mentions chzzk, 치지직, 방송감지, 방송 켜짐, broadcast detection, categoryTimeline, videoTitle 타임라인, openDate, 방송시작시간, 카테고리 변경, 제목 변경, polling, 또는 다시보기 탭 행 자동 생성 작업.
---

# 치지직 방송 감지 — Inel Scheduler

## 한 줄 요약
"1 방송 세션 = 1 row". LIVE ON → OFF 사이 모든 카테고리/제목 변경을 한 row 에 누적. 폴링 단절돼도 같은 `openDate` 면 같은 row 이어쓰기.

## 핵심 IPC 채널

| 채널 | 방향 | 용도 |
|---|---|---|
| `chzzk-start-polling` | renderer → main | url + interval ms |
| `chzzk-stop-polling` | renderer → main | |
| `chzzk-status` | main → renderer | LIVE on/off + 현재 title/category + uptime |
| `chzzk-category-change` | main → renderer | categoryId 바뀔 때만 emit |
| `chzzk-title-change` | main → renderer | title 바뀔 때만 emit |
| `chzzk-error` | main → renderer | 폴링 실패/네트워크 에러 |

## 폴링 흐름 (main.js)

```
setInterval(intervalMs) →
  fetch /service/v1/lives/{channelId} →
  parse {openLive, openDate, liveTitle, liveCategoryValue, ...} →
    LIVE ON 첫 감지: status=on emit + 첫 title 기록
    LIVE → LIVE (지속): title 변화면 title-change emit, category 변화면 category-change emit
    LIVE → OFF: status=off emit
    OFF → ON (재시작): 새 세션
```

### 변화 감지 키
- 카테고리: **`categoryId`** 비교 (display name 만 다르고 같은 카테고리인 경우 무시).
- 제목: 정확히 같은 문자열 아니면 변경으로 간주.
- 직전값은 main process 메모리 (`lastCategory`, `lastTitle`)에 보관.

## "1 세션 = 1 row" 운영 규칙 (renderer)

### ensureDetectRow (App.tsx)
LIVE ON 감지 시:
1. 현재 시각 KST 로 `broadcastDate` (YYYY-MM-DD) 계산.
2. `broadcastStartTime` = Chzzk `openDate` 를 KST HH:MM:SS 로 변환.
3. fullReplay rowsByTab 에서 같은 `broadcastDate + broadcastStartTime` row 가 있는지 검색.
   - 있음: 그 row 재사용 (단절 후 재개 케이스).
   - 없음: 새 row 생성 (`업로드` 빈값, `categoryTimeline` 빈값, `videoTitle` 첫 제목).
4. 활성 detect row 의 id 를 `activeDetectRowIdRef` 에 보관.

### 첫 제목 기록
`firstTitleRecorded` `useRef` 로 한 세션당 한 번만 기록. 중복 방지.

### appendCategoryTimeline / appendTitleTimeline
```
HH:MM:SS - <카테고리/제목>
HH:MM:SS - <다음 변경>
...
```
- 마지막 entry 와 같은 값이면 append 안 함 (중복 방지).
- 줄바꿈은 `\n` 한 개.
- timeline 컬럼은 fullReplay 에서 read-only 렌더 (`timeline-cell` 클래스).

### 단절 후 재개
- 인터넷/앱 일시 중단으로 폴링이 끊겼다가 다시 켜졌을 때:
  - Chzzk `openDate` 가 같으면 같은 세션 → 기존 row 의 timeline 에 이어 append.
  - 다르면 새 세션 → 새 row 생성.
- 자정 넘어간 경우도 동일 규칙. `broadcastDate` 는 세션 시작 일자 고정.

## 영구 저장 (자동 재개)
- `isDetecting` 상태를 `localStorage` (`inel.isDetecting.v1`) 에 저장.
- 앱 시작 시 `isDetecting === true && chzzkLink` 면 `startChzzkPolling` 한 번 자동 호출.
- `autoResumeDoneRef` 로 중복 자동 시작 방지.

## 즉시 시트 patch (`t12-a`)
카테고리/제목 변경 발생 시:
1. fullReplay 의 활성 row 갱신 (state).
2. 디바운스 없이 `sheetsPatchRow` 호출 (단, 같은 row 에 대한 중복 patch 는 짧은 디바운스 OK).
3. 시트에 카테고리 타임라인 즉시 반영.

## 새 카테고리 자동 등록 (`t12-b`)
- 폴링에서 받은 `categoryId` 가 로컬 카테고리 사전에 없으면:
  - `categories-add-user` IPC 호출.
  - `chzzk-categories-user.json` 에 누적.
  - 다음 폴링부터 같은 ID 면 사전 적중.

## "방송시작시간" 초단위 일관성
- 같은 LIVE 세션 안에서는 Chzzk `openDate` 가 항상 동일 (서버가 한 번 결정).
- 따라서 같은 row 검색 키로 `broadcastDate + broadcastStartTime` 사용 안전.
- 폴링 간격 (예: 30초) 동안 초가 흔들리지 않음.

## 흔한 버그 패턴

### `category is not defined` 무한 emit
- 원인: `chzzk-title-change` 핸들러가 정의 안 된 `category` 변수 참조.
- 해결: `categoryDisplay` 같은 정의된 변수로 교체.

### `categoryTimeline` 이 앱 재시작 후 사라짐
- 원인: 시트 미연결 상태 + dev 모드라 localStorage 미반영.
- 해결: 시트 연결 후엔 즉시 patch 로 시트가 진실. 시트 미연결도 `inel.rowsByTab.v1` 로 영구 저장됨.

### LIVE 켰는데 row 가 안 보임
- 원인: 보통 사용자가 다른 탭 또는 다른 달의 월 페이저에 있음.
- 해결: "다시보기 탭 + 오늘 달" 로 직접 안내. 자동 이동은 의도적으로 안 함 (사용자 화면 점프 방지).

### dev 모드에서 `createDetectRow` 가 2번 로그됨
- 원인: React StrictMode 더블 실행. 프로덕션 빌드에선 1회.
- 해결: 로그 무시. 실제 row 는 한 번만 생성됨 (id 중복 방지).

## 리소스 / 안정성
- 폴링은 단순 fetch + JSON parse. CPU/메모리 영향 미미.
- 네트워크 끊기면 `chzzk-error` 한 번 emit 후 polling 자체는 다음 interval 에 자동 재시도.
- 무한 재시도. 사용자가 "방송감지 OFF" 누를 때까지.

## 절대 하지 말 것
- 폴링 인터벌을 1초 이하로 (치지직 서버 부담 + IP 차단 위험).
- `chzzk-status` 매 emit 마다 시트 patch 호출 (디바운스 없이 호출하면 quota 초과).
- `lastCategory` 비교를 categoryDisplay 로 하기 (id 로 해야 함).
- LIVE OFF 후 행 자동 삭제 (의도적으로 row 보존).
