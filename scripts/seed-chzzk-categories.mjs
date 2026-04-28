/**
 * 치지직 비공식 라이브 목록 / 라이브 검색 API를 크롤링하여
 * unique 카테고리 시드 데이터를 생성한다.
 *
 *   node scripts/seed-chzzk-categories.mjs
 *   (또는 npm run seed:chzzk-categories)
 *
 * 결과: src/data/chzzk-categories.seed.json
 *
 * 비공식 카테고리 검색 endpoint가 공개되어 있지 않아,
 * 라이브 페이지네이션(POPULAR + LATEST) + 다양한 키워드 검색을 합쳐서 가능한 한 많이 수집한다.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT = path.resolve(__dirname, "..", "src", "data", "chzzk-categories.seed.json");
const PAGE_SIZE = 50;
const LIVES_MAX_PAGES = { POPULAR: 80, LATEST: 200 };
const SEARCH_MAX_PAGES = 5;
const REQUEST_DELAY_MS = 250;

const SEARCH_KEYWORDS = [
  // 한글 자모
  "가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하",
  // 인기 한글 단어 (게임/콘텐츠)
  "게임", "노래", "토크", "음악", "그림", "요리", "공부", "야외", "ASMR",
  "리그", "발로", "오버", "배그", "마크", "롤", "스타", "철권", "포켓", "파판",
  "이터", "원신", "젠레", "디아", "월드", "엘든", "발더", "스팀",
  // SPORTS 보강
  "스포츠", "축구", "야구", "농구", "배구", "골프", "바둑", "수영",
  "탁구", "배드민턴", "테니스", "권투", "격투", "F1", "레이싱", "올림픽",
  // ETC 보강
  "운동", "건강", "과학", "기술", "시사", "경제", "먹방", "쿡방",
  "뷰티", "여행", "캠핑", "일상", "스터디", "코딩", "채팅", "잡담",
  // ENTERTAINMENT 보강
  "애니", "드라마", "영화", "예능", "만화", "웹툰",
  // 영문
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"
];

const NON_GAME_SEED = [
  { categoryType: "ETC", categoryId: "talk", categoryValue: "토크" },
  { categoryType: "ETC", categoryId: "music", categoryValue: "음악/노래" },
  { categoryType: "ETC", categoryId: "asmr", categoryValue: "ASMR" },
  { categoryType: "ETC", categoryId: "art", categoryValue: "그림/아트" },
  { categoryType: "ETC", categoryId: "cook", categoryValue: "요리/먹방" },
  { categoryType: "ETC", categoryId: "irl", categoryValue: "야외/일상" },
  { categoryType: "ETC", categoryId: "study", categoryValue: "스터디" },
  { categoryType: "ETC", categoryId: "movie", categoryValue: "영화/드라마" }
];

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (inel-scheduler seed script)",
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`API code ${json.code}: ${json.message}`);
  return json.content;
}

function pickFromLive(live) {
  const id = live.liveCategory || live.videoCategory || null;
  const value = live.liveCategoryValue || live.videoCategoryValue || null;
  const type = live.categoryType || null;
  if (!id || !value || !type) return null;
  return { categoryId: id, categoryValue: value, categoryType: type };
}

async function crawlLives(sortType, sink, stats) {
  const maxPages = LIVES_MAX_PAGES[sortType] || 60;
  let next = null;
  for (let i = 0; i < maxPages; i++) {
    const params = new URLSearchParams();
    params.set("size", String(PAGE_SIZE));
    params.set("sortType", sortType);
    if (next) params.set("next", JSON.stringify(next));

    let content;
    try {
      content = await fetchJson(`https://api.chzzk.naver.com/service/v1/lives?${params}`);
    } catch (err) {
      console.error(`\n[lives:${sortType}] page ${i + 1} failed: ${err.message}`);
      break;
    }
    const lives = content?.data || [];
    stats.totalLives += lives.length;
    let added = 0;
    for (const live of lives) {
      const cat = pickFromLive(live);
      if (cat && !sink.has(cat.categoryId)) {
        sink.set(cat.categoryId, cat);
        added++;
      }
    }
    process.stdout.write(`\r[lives:${sortType}] page ${i + 1}/${maxPages} (lives: ${stats.totalLives}, +${added}, unique: ${sink.size})       `);
    next = content?.page?.next;
    if (!next || lives.length === 0) break;
    await sleep(REQUEST_DELAY_MS);
  }
  process.stdout.write("\n");
}

async function crawlSearchKeyword(keyword, sink, stats) {
  let offset = 0;
  for (let i = 0; i < SEARCH_MAX_PAGES; i++) {
    const params = new URLSearchParams();
    params.set("size", String(PAGE_SIZE));
    params.set("offset", String(offset));
    params.set("keyword", keyword);

    let content;
    try {
      content = await fetchJson(`https://api.chzzk.naver.com/service/v1/search/lives?${params}`);
    } catch (err) {
      break;
    }
    const items = content?.data || [];
    if (items.length === 0) break;
    stats.totalSearch += items.length;
    let added = 0;
    for (const item of items) {
      const live = item.live || item;
      const cat = pickFromLive(live);
      if (cat && !sink.has(cat.categoryId)) {
        sink.set(cat.categoryId, cat);
        added++;
      }
    }
    process.stdout.write(`\r[search:${keyword}] page ${i + 1} (+${added}, unique: ${sink.size})            `);
    const nextOffset = content?.page?.next?.offset;
    if (typeof nextOffset !== "number" || nextOffset <= offset) break;
    offset = nextOffset;
    await sleep(REQUEST_DELAY_MS);
  }
  process.stdout.write("\n");
}

async function main() {
  const sink = new Map();
  const stats = { totalLives: 0, totalSearch: 0 };

  for (const seed of NON_GAME_SEED) sink.set(seed.categoryId, seed);

  console.log("=== Phase 1: lives (POPULAR) ===");
  await crawlLives("POPULAR", sink, stats);

  console.log("=== Phase 2: lives (LATEST) ===");
  await crawlLives("LATEST", sink, stats);

  console.log("=== Phase 3: search/lives by keywords ===");
  for (const kw of SEARCH_KEYWORDS) {
    await crawlSearchKeyword(kw, sink, stats);
  }

  const merged = Array.from(sink.values()).sort((a, b) => {
    if (a.categoryType !== b.categoryType) return a.categoryType.localeCompare(b.categoryType);
    return a.categoryValue.localeCompare(b.categoryValue, "ko");
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "service/v1/lives (POPULAR + LATEST) + service/v1/search/lives (다양한 키워드) + manual ETC seed",
    note: "비공식 API 크롤링 결과. 활동 중 라이브가 있는 카테고리만 수집됨. 비활성 카테고리는 런타임 자동 등록(다시보기)으로 보강.",
    crawlStats: { ...stats, keywordsCount: SEARCH_KEYWORDS.length },
    count: merged.length,
    categories: merged
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\n✔ 시드 저장 완료: ${OUTPUT}`);
  console.log(`  카테고리 ${merged.length}개 (총 라이브 조회: ${stats.totalLives + stats.totalSearch})`);
}

main().catch((err) => {
  console.error("seed script failed:", err);
  process.exit(1);
});
