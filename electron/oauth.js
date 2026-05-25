/**
 * OAuth 2.0 Desktop flow — Google 계정 로그인 + 토큰 관리.
 *
 * 흐름:
 *   1) 사용자가 [Google 로그인] 클릭 → renderer 에서 IPC oauth-login 호출
 *   2) main 이 @google-cloud/local-auth 의 authenticate() 호출
 *      → 시스템 브라우저에 Google 로그인 페이지 열림
 *      → 사용자가 로그인 + 동의 → loopback 으로 authorization code 회신
 *      → access_token + refresh_token 교환
 *   3) refresh_token 을 Electron safeStorage 로 암호화 → userData 에 저장
 *      (OS 키체인 / Windows DPAPI 기반 → 다른 사용자가 디스크 직접 봐도 못 읽음)
 *   4) googleapis 의 sheets API 호출은 이 OAuth2Client 의 access_token 사용
 *   5) access_token (1시간) 만료 시 refresh_token 으로 자동 갱신
 *
 * 토큰 저장 파일: <userData>/oauth-tokens.bin (safeStorage 암호문)
 */
const path = require("path");
const fs = require("fs");
const https = require("https");
const { google } = require("googleapis");
const { authenticate } = require("@google-cloud/local-auth");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email"
];

const KEYFILE_PATH = path.join(__dirname, "oauth-client.json");

// safeStorage 는 모듈 로드 시점이 아니라 app ready 후에 사용 가능. 함수 안에서 require.
function getSafeStorage() {
  const { safeStorage } = require("electron");
  return safeStorage;
}

function tokensPath(app) {
  return path.join(app.getPath("userData"), "oauth-tokens.bin");
}

function clientInfoPath(app) {
  return path.join(app.getPath("userData"), "oauth-user.json");
}

function loadClientFile() {
  if (!fs.existsSync(KEYFILE_PATH)) {
    throw new Error(`OAuth client 파일이 없습니다: ${KEYFILE_PATH}. Google Cloud Console 에서 받은 JSON 을 그 경로에 두세요.`);
  }
  const raw = fs.readFileSync(KEYFILE_PATH, "utf8");
  const json = JSON.parse(raw);
  const cfg = json.installed || json.web || json;
  if (!cfg.client_id || !cfg.client_secret) {
    throw new Error("OAuth client 파일에 client_id / client_secret 가 없습니다.");
  }
  return cfg;
}

/**
 * 메모리에 살아있는 OAuth2Client (sheets 호출 시 재사용).
 * setCredentials({ refresh_token }) 만 해두면 googleapis 가 access_token 자동 갱신.
 */
let oauthClient = null;
let currentUserEmail = null;

function createClient() {
  const cfg = loadClientFile();
  // redirect_uri 는 authenticate() 가 동적으로 loopback 설정. 여기선 placeholder.
  const client = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  // 액세스 토큰 만료 5분 전부터 미리 refresh — googleapis 호출이 만료된 토큰을
  // 사용해 401/403 "unregistered callers" 받는 케이스 방지.
  client.eagerRefreshThresholdMillis = 5 * 60 * 1000;
  return client;
}

/**
 * Google userinfo endpoint 를 직접 호출해 이메일 조회.
 * googleapis 의 oauth2.userinfo.get() 이 가끔 빈 결과를 반환하는 케이스가 있어 우회.
 * scope userinfo.email 필요.
 * @param {OAuth2Client} client
 * @returns {Promise<string|null>}
 */
async function fetchUserEmail(client) {
  try {
    if (!client) return null;
    const tokenInfo = await client.getAccessToken();
    const accessToken = (tokenInfo && (tokenInfo.token || tokenInfo)) || null;
    if (!accessToken || typeof accessToken !== "string") return null;
    return await new Promise((resolve) => {
      const req = https.request({
        hostname: "www.googleapis.com",
        path: "/oauth2/v2/userinfo",
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      }, (res) => {
        let buf = "";
        res.on("data", (chunk) => { buf += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(buf);
            resolve(json && typeof json.email === "string" ? json.email : null);
          } catch (_e) { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => { try { req.destroy(); } catch (_e) { /* ignore */ } resolve(null); });
      req.end();
    });
  } catch (_e) {
    return null;
  }
}

function saveRefreshToken(app, refreshToken, userEmail) {
  try {
    const ss = getSafeStorage();
    if (!ss.isEncryptionAvailable()) {
      // 암호화 불가 환경 (드물지만 일부 Linux). 평문 저장으로 fallback (보안 약화 알림 로그).
      fs.writeFileSync(tokensPath(app), JSON.stringify({ refresh_token: refreshToken, plain: true }), "utf8");
    } else {
      const encrypted = ss.encryptString(refreshToken);
      fs.writeFileSync(tokensPath(app), encrypted);
    }
    if (userEmail) {
      fs.writeFileSync(clientInfoPath(app), JSON.stringify({ email: userEmail, savedAt: new Date().toISOString() }), "utf8");
    }
    return true;
  } catch (err) {
    return false;
  }
}

function loadRefreshToken(app) {
  try {
    const p = tokensPath(app);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const ss = getSafeStorage();
    if (!ss.isEncryptionAvailable()) {
      try {
        const obj = JSON.parse(buf.toString("utf8"));
        return obj && obj.refresh_token ? obj.refresh_token : null;
      } catch { return null; }
    }
    return ss.decryptString(buf);
  } catch (err) {
    return null;
  }
}

function loadStoredEmail(app) {
  try {
    const p = clientInfoPath(app);
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    return obj && obj.email ? obj.email : null;
  } catch { return null; }
}

function clearTokens(app) {
  try { if (fs.existsSync(tokensPath(app))) fs.unlinkSync(tokensPath(app)); } catch (_e) { /* ignore */ }
  try { if (fs.existsSync(clientInfoPath(app))) fs.unlinkSync(clientInfoPath(app)); } catch (_e) { /* ignore */ }
  oauthClient = null;
  currentUserEmail = null;
}

/**
 * 시스템 브라우저로 Google 로그인 페이지 열어 사용자 인증 받음.
 * 성공 시 refresh_token 영구 저장 + oauthClient 메모리에 보관.
 *
 * @returns {Promise<{ok:boolean, email?:string, error?:string}>}
 */
async function login(app) {
  try {
    const result = await authenticate({
      keyfilePath: KEYFILE_PATH,
      scopes: SCOPES
    });
    // result 는 OAuth2Client. credentials 안에 access_token / refresh_token.
    if (!result || !result.credentials) {
      return { ok: false, error: "인증 결과가 비어있음" };
    }
    const refresh = result.credentials.refresh_token;
    if (!refresh) {
      return { ok: false, error: "refresh_token 발급 실패 (이미 발급된 적이 있을 수 있음. 본인 Google 계정 → 보안 → 연결된 앱에서 'Inel Scheduler' 제거 후 다시 시도)" };
    }
    // 사용자 이메일 조회 — googleapis 의 oauth2.userinfo.get() 이 빈 결과를 줄 때가
    // 있어서 더 신뢰성 있는 userinfo endpoint 를 직접 호출.
    const email = await fetchUserEmail(result);

    saveRefreshToken(app, refresh, email);
    oauthClient = result;
    currentUserEmail = email;
    return { ok: true, email };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * 저장된 refresh_token 으로 OAuth2Client 복원. 앱 시작 시 1회 호출.
 * 성공 시 oauthClient 메모리에 보관.
 * @returns {Promise<{ok:boolean, email?:string, error?:string}>}
 */
async function restore(app) {
  try {
    const refresh = loadRefreshToken(app);
    if (!refresh) return { ok: false, error: "저장된 토큰 없음" };
    const client = createClient();
    client.setCredentials({ refresh_token: refresh });
    // access_token 한 번 강제 갱신해서 유효성 검증
    await client.getAccessToken();
    oauthClient = client;
    currentUserEmail = loadStoredEmail(app);
    return { ok: true, email: currentUserEmail };
  } catch (err) {
    // refresh_token 만료/거부. 저장된 토큰 무효화.
    clearTokens(app);
    return { ok: false, error: err.message || String(err) };
  }
}

function logout(app) {
  clearTokens(app);
  return { ok: true };
}

function getClient() {
  return oauthClient;
}

function getUserEmail() {
  return currentUserEmail;
}

function isLoggedIn() {
  return oauthClient !== null;
}

/**
 * sheets API 호출 직전에 토큰이 만료됐으면 강제 refresh. eagerRefreshThresholdMillis
 * 가 있어 보통은 자동 처리되지만, 일부 케이스 (앱이 오래 켜져있다가 갑자기 호출 등)
 * 에서는 명시 호출이 더 안전.
 */
async function ensureFreshToken() {
  if (!oauthClient) return false;
  try {
    await oauthClient.getAccessToken();
    return true;
  } catch (_e) {
    return false;
  }
}

module.exports = {
  SCOPES,
  login,
  restore,
  logout,
  getClient,
  getUserEmail,
  isLoggedIn,
  ensureFreshToken
};
