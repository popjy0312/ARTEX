# api-recon — 참고 매뉴얼

grep 레시피, `config.json` 템플릿 및 장애 해결 방법입니다. 모든 grep은 `js/` 디렉터리에서 실행합니다. bundle이 한 줄이면 먼저 `js-beautify` 또는 `sed 's/}/}\n/g'`를 사용하며, 보통은 컨텍스트 창을 둔 raw grep으로 충분합니다.

## 스크립트 설명

`scripts/`의 모든 파일은 **참고 템플릿**이며 실행 전에 대상 사이트에 맞게 조정해야 합니다. 대표적인 수정 지점은 다음과 같습니다.

| 스크립트 | 일반적인 수정 항목 |
|---|---|
| `harvest_static.py` | endpoint 정규식, webpack/Vite manifest 해석, 마이크로프런트엔드 publicPath, 재시도/동시성 |
| `runtime_harvest.js` | neutralize 필드명과 성공값, stub 매칭 규칙과 body 구조, routes 출처, WS 기록、`waitUntil`/`routeTimeout`/`proxy` |
| `preload.js` | `loginPathRe`, L1 stubs, `neutralize.fields`, `apiPattern`, L3 활성화 여부, `recordDetail`, `observe.*`, `neutralizeVueRouter` |
| `spider_mpa.py` | `--exclude` 파괴적 링크, cookie, depth/max, 동일 출처 필터 |
| `extract_route_map.py` | `routeMap` / `routeLink` 정규식, KEY 명명 패턴 |
| `build_perm_tree.py` | `userRouteAuth` 해석, `ROOTS`/`PREFIX_PARENT` 계층 휴리스틱, stub 외부 필드명 |
| `config.json` | 위 모든 사이트 전용 매개변수의 통합 진입점 |

수정한 파일은 작업 디렉터리(예: `recon/`)에 두고, 보고서에 참고 스크립트 대비 구체적인 변경 사항을 기록합니다.

---

## A. 세 게이트 역공학

### A1. 렌더링 게이트 — 「로그인 상태를 어떻게 판단하는가?」

```bash
grep -rhoaE '.{0,40}(isLogin|isAuthenticated|loggedIn|hasLogin|requireAuth)\b.{0,80}' js | head
grep -rhoaE 'function (getUser|getToken|getAuth)[0-9]?\([^)]*\)\{.{0,200}' js | head
grep -rhoaE '(localStorage|sessionStorage)\.getItem\("[^"]+"\)' js | sort -u
grep -rhoaE '(Cookies?|cookie)\.(get|load)\("[^"]+"\)' js | sort -u
grep -rhoaE '\batob\(|JSON\.parse\(|jwt|decode' js | head
```

`isLogin = f(getUser())` → `getUser = decode(storage.read(KEY))` 체인을 추적하여，결정 **저장 키**、**컨테이너**（Cookie vs localStorage）、**인코딩**：

| 인코딩 | config 위조 방식 |
|---|---|
| 평문 문자열 / `"1"` / token | `"value": "anything-truthy"` |
| `JSON.parse(x)` | `"value": "json:{\"id\":1,\"username\":\"admin\"}"` |
| `JSON.parse(atob(x))` | `"value": "b64json:{\"id\":1,\"username\":\"admin\"}"` |
| JWT | 서명 없는/`alg:none` JWT 또는 bundle 내부 키로 서명 |
| 암호화(SM2/AES/RSA) | 하드코딩 키를 찾고, 렌더링 게이트에 해독 가능한 blob만 필요하면 forge; 그렇지 않으면 정적 fallback |

→ `cookies` / `localStorage`에 기록합니다.

### A2. interceptor 게이트 — 「무엇이 /login으로 이동하게 하는가?」

```bash
grep -rhoaE '.{0,60}(interceptors\.response|axios|request\.use).{0,120}' js | head
grep -rhoaE '.{0,40}(response_code|errcode|errno|\bcode\b|\bret\b|\bstatus\b)\s*[=!]==?\s*[\-0-9]{1,4}.{0,60}' js | head -20
grep -rhoaE '.{0,40}(not\s*logged?\s*in|please\s*log\s*in|session\s*expired|unauthorized|access\s*denied|token.{0,10}invalid).{0,40}' js | head
grep -rhoaE '.{0,30}(location\.href|router\.(push|replace)|navigate)\([^)]*login[^)]*\)' js | head
```

**필드명**, **성공값**(보통 `0` 또는 `200`), 이동을 유발하는 **실패값**을 결정합니다. junk session으로 확인합니다:

```bash
curl -sk -X POST -H 'Cookie: <fakekey>=junk' https://target/api/<protected> -d '{}' -H 'Content-Type: application/json'
```

→ `neutralize.fields` + `neutralize.success`에 기록합니다.

### A3. 콘텐츠 게이트 — 「메뉴/권한은 어디서 오는가?」

```bash
grep -rhoaE '"/api[^"]*(permission|perm|role|menu|acl|resource|nav)[^"]*"' js | sort -u
grep -rhoaE '.{0,30}(menus|permissions|menuList|routeList|authList|role_permissions)\b.{0,120}' js | head
grep -rhoaE 'userRouteAuth|getResultTree|routeMap|routeLink|hasPermission|checkAuth' js | head
grep -rhoaE '([A-Z_][A-Z0-9_]*):\{name:"[^"]*",link:"/[^"]+"\}' js | head
```

**2계층 데이터**(일반적인 기업 백오피스):

| API | 전형적인 payload | 소비자 |
|---|---|---|
| `.../role_permissions` | `{ permissions: string[], role_type }` | 라우트 가드, 버튼 수준 ACL |
| `.../permissions/all` | `tree[{ code, position, children }]` | 사이드바 메뉴 렌더링 |
| bundle 내부 `userRouteAuth` | `{ CODE: { url, name? } }` | code → 프런트엔드 path |
| bundle 내부 `routeMap` | `{ KEY: { name, link } }` | 별칭 해석(webpack `o.DASHBOARD`) |

소비자 코드에서 `getResultTree(tree, permissions)`의 필터링 방식과 `v-if` / `hasAuth(code)`가 검사하는 필드를 확인합니다.

**수동 forge**(소규모 사이트): permissive payload를 생성하여 `stubs`에 넣습니다.

**전체 권한 트리 복원**(대규모 사이트에서 사이드바/하위 모듈이 계속 비어 있음)은 **I절**을 참조합니다.

---

## B. config.json 템플릿

```json
{
  "baseUrl": "https://target/",
  "runtimeMode": "both",
  "chromium": "/usr/bin/chromium",

  "cookies": [
    { "name": "auth", "value": "b64json:{\"id\":1,\"username\":\"admin\",\"role\":\"admin\",\"func\":{},\"permissions\":[\"*\"]}" }
  ],
  "localStorage": { "token": "faketoken", "isLogin": "1" },

  "neutralize": {
    "fields": ["response_code", "code", "errno", "ret", "status"],
    "success": 0,
    "flags": { "success": true, "message": "ok" }
  },
  "forward": true,
  "loginUrlPattern": "/login",
  "apiPattern": "/api/|/rest/|/graphql",

  "mockTier": "L1+L2",
  "recordDetail": true,
  "observe": {
    "storageReads": false,
    "cookieReads": false,
    "xhrHeaders": true
  },
  "neutralizeVueRouter": true,
  "stubs": [
    {
      "match": "permissions/all|/menu|role_permissions",
      "body": {
        "response_code": 0, "code": 0,
        "data": {
          "permissions": ["*"],
          "menus": [
            { "name": "dashboard", "path": "/dashboard", "show": true, "children": [] },
            { "name": "alert", "path": "/alert", "show": true, "children": [] }
          ]
        }
      }
    }
  ],

  "explore": {
    "clickTabs": true,
    "clickTables": true,
    "pushStateFallback": true,
    "maxMenuItems": 50
  },

  "routes": ["/dashboard", "/alert", "/asset", "/device", "/report", "/config", "/system"],
  "waitMs": 1500, "perRouteMs": 900, "headless": true,
  "waitUntil": "domcontentloaded",
  "routeTimeout": 12000,
  "proxy": "",

  "captureResponses": true, "recordWs": true, "respMax": 600
}
```

필드 설명:
- `runtimeMode`：`depth`（Puppeteer）、`coverage`（browser MCP）、`both`
- `cookies[].value` 접두사: `b64json:` → base64(JSON); `json:` → 원시 JSON; 접두사 없음 → 리터럴
- `forward: true`는 실제 요청을 전달하고 코드 필드를 다시 씁니다; `false`는 완전 오프라인 stub입니다.
- `mockTier`: coverage 모드 preload에서 활성화할 계층(예: `L1+L2`, `L1+L2+L3`)
- `routes`는 `routes.txt`에서 가져오며, 메뉴 forge 후 harness가 `<a href>`를 자동 추가합니다.
- `captureResponses` / `recordWs`는 depth 모드에서만 유효합니다.
- `waitUntil`: 대형 SPA는 `domcontentloaded`를 사용해 `networkidle2` 정지를 피합니다.
- `routeTimeout`: 단일 라우트의 `page.goto` timeout(밀리초)
- `proxy`: Puppeteer `--proxy-server`; `HTTP_PROXY` / `HTTPS_PROXY`도 설정할 수 있습니다.

### B1. 이중 stub 템플릿(role_permissions + permissions/all)

```json
"stubs": [
  {
    "match": "role_permissions",
    "body": {
      "response_code": 0,
      "data": {
        "permissions": ["MONITOR", "MONITOR_ALERT", "THREAT", "ASSETS_RISK"],
        "role_type": "SUPER_ADMIN"
      }
    }
  },
  {
    "match": "permissions/all",
    "body": {
      "response_code": 0,
      "data": [
        {
          "code": "MONITOR",
          "position": 1,
          "children": [
            { "code": "MONITOR_ALERT", "position": 1, "children": [] }
          ]
        }
      ]
    }
  }
]
```

외부 필드명(`response_code` / `code` / `data`)은 A2 interceptor 게이트와 일치해야 하며, `permissions`는 tree의 모든 leaf code를 덮어야 합니다.

---

## C. coverage 모드: preload 설정

`scripts/preload.js` 상단의 `CONFIG` 객체를 편집하거나 CDP 주입 전에 교체합니다:

```javascript
const CONFIG = {
  loginPathRe: /\/(login|signin)(\/|$|\?)/i,
  mockTier: 'L1+L2',
  forward: true,
  recordDetail: true,
  extractUrlsFromResponse: true,
  neutralizeVueRouter: true,
  observe: { storageReads: false, cookieReads: false, xhrHeaders: true },
  neutralize: { fields: ['response_code', 'code'], success: 0 },
  stubs: [ /* config.json stubs와 동일 */ ],
  apiPattern: /\/(api|apis|v\d+|dev|internal|graphql)\//i,
};
```

`window.__API_RECON_PRELOAD__ === true`이고 pathname이 안정적인지 확인합니다.

기록 결과 내보내기:

```javascript
JSON.stringify({
  apis: [...window.__API_RECON_LOG__],
  detail: window.__API_RECON_DETAIL__,
  routes: [...(window.__API_RECON_ROUTES__ || [])],
  observe: window.__API_RECON_OBSERVE__,
}, null, 2)
```

---

## D. preload / runtime Hook 기능

preload(coverage)와 runtime_harvest(depth)에 내장된 브라우저 Hook 기능 및 커버 범위입니다:

| Hook 기능 | API 발견에서의 가치 | 커버 |
|---|---|---|
| Hook fetch / XHR.open | 요청 URL/메서드 기록 | ✅ `recordDetail` + `__API_RECON_LOG__` |
| Hook XHR.setRequestHeader | Authorization 등의 헤더 발견 | ✅ `observe.xhrHeaders` |
| Hook localStorage/cookie 읽기 | 세션 키 이름 확인 | ⚠️ 선택적 `observe.storageReads/cookieReads` |
| Vue 라우트 획득 | 보완 frontendRoutes | ✅ `__API_RECON_ROUTES__`（로드된 라우트） |
| Vue 라우트 가드 중화 / 로그인 이동 차단 | 모듈 트리거 API 확장 | ✅ `neutralizeVueRouter` + 네이티브 이동 중화 |
| React 라우트 획득 | 라우트 보완 | ⚠️ 정적 + 클릭；전용 없음 Hook |
| 페이지 이동 차단(로그인 path) | 페이지 유지 분석 | ⚠️ 로그인 path만 차단하여 업무 navigation을 막지 않음 |
| 암호화 라이브러리 Hook(CryptoJS/SM 등) | 암호화 매개변수 → 평문 API body | ❌ 암호화 함수 입력을 수동 Hook해야 함; 결론은 config에 기록 |
| anti-debug bypass | 처리하지 않으면 runtime에서 API를 기록할 수 없음 | ❌ 수동 처리 필요; 정적 분석은 여전히 사용 가능 |

---

## E. Endpoint 추출 정규식(정적 결과가 너무 적을 때)

`harvest_static.py`의 `extract_endpoints`를 넓히거나 수동으로 실행합니다.

```bash
grep -rhoaE '"/[a-z][A-Za-z0-9_/\-]{3,}"' js | sort -u
grep -rhoaE '/api/[a-zA-Z0-9_./-]+' js | sort -u
```

---

## F. 장애 해결

| 현상 | 원인 → 처리 |
|---|---|
| 정적 API가 적음 | endpoint 방언 불일치 → 정규식 완화(D절) |
| chunk 수 ≪ manifest | CSS-only 또는 배포되지 않은 chunk; 404 재시도 |
| runtime에도 로그인 페이지 | 렌더링 게이트 오류 → A1의 키 이름, 컨테이너, 인코딩, domain 재확인 |
| 셸에 진입했지만 모듈이 비어 있음 | 콘텐츠 게이트 → 메뉴 forge(A3); `routes` path가 틀릴 수 있음 |
| 각 라우트에 bootstrap/locale만 있음 | 권한 코드가 부족함 → I절 권한 트리 복원; `role_permissions` + `permissions/all` 이중 stub 확인 |
| 사이드바 항목은 있으나 하위 페이지가 비어 있음 | tree에 중간 노드가 없거나 code가 `userRouteAuth`와 불일치 |
| 모든 API가 로그인으로 이동 | interceptor 게이트 → `neutralize` 확인; 중첩 필드는 walk 로직 확장 |
| WS frame이 0 | 사용자 상호작용 후에만 subscribe; `perRouteMs` 연장 |
| 응답 body가 비어 있음 | `forward: true`일 때만 실제 응답이 있음 |
| Chromium 없음 | chromium 설치 또는 `config.chromium` / `CHROMIUM` 설정 |
| Mock이 많아도 로그인으로 돌아감 | Hook이 늦거나 `location.href` setter 누락 → document-start + preload |
| 목록이 전부 비어 있음 | L3 빈 배열은 정상; Tab/설정/상세를 계속 클릭 |
| Redux action을 라우트로 오인 | get/set/change/clear/toggle/upload가 포함된 내부 path 필터 |
| Vue가 계속 로그인으로 이동 | preload가 document-start가 아님 → 주입 시점 수정; 또는 `neutralizeVueRouter: false`이면 guard 수동 제거 |
| 응답에 URL이 있지만 log에 없음 | `extractUrlsFromResponse` 활성화; 또는 `__API_RECON_DETAIL__`에서 수동 추출 |
| Authorization 헤더 이름을 모름 | `observe.xhrHeaders` 활성화 또는 DevTools 요청 헤더 확인 |
| runtime이 매우 느리거나 timeout | `waitUntil: domcontentloaded`로 변경; `routeTimeout` 축소; `networkidle2` 사용 금지 |
| 프록시 연결 실패 | `proxy` / 환경 변수 확인; Puppeteer와 curl의 프록시 포트 일치 |

---

## G. 강화된 대상

서버가 세션을 단계적으로 검증하여 위조할 수 없는 서명 cookie나 stub할 수 없는 서버 렌더링 메뉴를 사용하면 runtime은 shell에서 멈춥니다. 예상 동작:

- **정적 분석만으로 endpoint 열거 가능** — 모듈 path는 코드에 있음
- 승인 범위에서 가능하면 **실제 세션**으로 동일 harness 실행: `forward: true`, neutralize 불필요, 실제 methods/params/responses 캡처

---

## H. 단일 작업 체크리스트

1. 확인승인범위
2. **읽기** `scripts/harvest_static.py` → 대상에 맞게 조정 → 실행 → `api_static.txt`, `routes.txt` 검토
3. **Phase 1b**: path 앵커 확장 + 바인딩 계층 → `param_candidates.json`(J절)
4. A1/A2/A3 역공학 → 사이트 전용 `config.json` 작성
5. **읽고 조정한 뒤** `runtime_harvest.js` / `preload.js` 실행
6. `runtimeMode=depth`: `npm install` → 조정한 harvest 스크립트 실행
7. `runtimeMode=coverage/both`: 조정한 preload를 document-start로 주입 → browser MCP 동적 열거 + **매개변수 트리거 매트릭스**
8. 모듈이 렌더링되지 않음 → **I절 권한 트리 복원** → stubs patch → 재실행
9. 다중 샘플 diff + 오류 역추론 → `params_merged.json`
10. 병합 → `site_map.json` + `api_merged.txt`; 커버리지, 누락 및 스크립트 변경 지점을 정직하게 표시

---

## I. 권한 트리 복원(Phase 4 심화)

단순한 `menus: [{ path, show: true }]` forge가 작동하지 않고 하위 모듈도 mount되지 않을 때 사용합니다.

### I1. auth 모듈 찾기

```bash
grep -l 'userRouteAuth' js/*.js
grep -l 'routeMap\|routeLink' js/*.js
grep -rhoaE 'getResultTree|role_permissions|permissions/all' js | head
```

**권한 API path**, **응답 필드명**, **소비 chunk 파일명**을 기록합니다.

### I2. routeMap 추출

```bash
python3 scripts/extract_route_map.py recon/js recon/
# recon/route_map.json 생성
```

`[!] no routeMap pattern found`가 나오면 `extract_route_map.py`의 정규식을 넓히거나 수동 grep합니다.

```bash
grep -rhoaE '([A-Z_][A-Z0-9_]*):\{name:"[^"]*",link:"/[^"]+"\}' js | head -20
```

### I3. 권한 트리 + stub 생성

```bash
python3 scripts/build_perm_tree.py recon/js recon/ --config recon/config.json
```

스크립트 로직:
1. `userRouteAuth={MONITOR:{url:...},...}` 해석(webpack 별칭 `He=o.DASHBOARD` 포함)
2. `route_map.json`으로 alias → 실제 path 해석
3. code 접두사로 parent 추정(`MONITOR_ALERT` → `MONITOR`)
4. 출력 `permissions_tree.json`、`permissions_all_stub.json`、`role_permissions_stub.json`
5. `--config` 사용 시 `config.json`의 `stubs`를 자동 기록하고 `routes`를 확장

**대상에 맞게 조정**(스크립트 상단):
- `DEFAULT_ROOTS`: 최상위 모듈 code 목록
- `DEFAULT_PREFIX_PARENT`: `PREFIX_` → parent 매핑
- `DEFAULT_EXTRA_PARENT`: 접두사가 아닌 관계의 orphan 노드

### I4. stub 일관성 확인

```bash
# permissions 수는 userRouteAuth 항목 수와 거의 같아야 함
wc -l recon/perm_codes_all.txt
# routes는 route_map의 모든 link를 덮어야 함
python3 -c "import json; m=json.load(open('recon/route_map.json')); r=set(json.load(open('recon/config.json'))['routes']); print('missing', [v['link'] for v in m.values() if v['link'] not in r])"
```

### I5. runtime 재실행 및 비교

```bash
node recon/runtime_harvest.js recon/config.json
# forge 전후 runtime_api.json 수 비교; /attack, /asset 등의 모듈 API가 나타나는지 확인
```

| forge 전 | forge 후(성공) |
|---|---|
| 모든 라우트가 동일한 bootstrap 3–5개 | 서로 다른 라우트가 서로 다른 module API를 트리거 |
| `/api/locale/language`만 있음 | `/api/web/...` 모듈 endpoint 출현 |
| `routes.txt`가 한 자리 라우트 | route_map에서 온 `routes`가 80–110+ |

### I6. 계속 실패할 때

- **coverage 모드**: 사이드바 + Tab 클릭; 권한 gating은 상호작용 뒤에 요청될 수 있음
- **stub 필드**: 실제 API(curl + 실제 session)와 stub의 nesting 비교
- **추가 guard**: `hasPermission|checkRole|func.` 등 버튼 수준 검사를 grep하고 `role_permissions.permissions` 확장
- **정적 fallback**: 모듈 API path는 여전히 `api_static.txt`에 있고 runtime은 METHOD/body만 보완; 매개변수는 `param_candidates.json`과 이미 기록한 샘플 유지

---

## J. 매개변수 역공학(Phase 1b / 5b / 5c)

**방법론이며 범용 스크립트가 아닙니다.** path는 정규식으로, 매개변수는 앵커 확장 + UI 바인딩 체인 + 다중 샘플 diff + 오류 역추론으로 찾습니다.

### J1. 앵커 확장 — path에서 요청 조립 객체 찾기

```bash
# Phase 1에서 확인한 path를 앵커로 사용
grep -n '"/api/user/list"' js/*.js
grep -rhoaE '.{0,120}("/api[^"]+").{0,200}' js | head
grep -rhoaE '(params|data|body|payload)\s*:\s*\{' js | head
grep -rhoaE '(get|post|put|delete|patch)\([^,]+,\s*\{' js | head
```

### J2. 래퍼 계층과 전송 형태

```bash
# axios / 통합 request
grep -rhoaE '(axios|request)\.(get|post|put|delete|patch)\(' js | head
grep -rhoaE 'interceptors\.(request|response)' js | head

# GraphQL
grep -rhoaE '(query|mutation)\s+\w+|gql`|graphql\(' js | head
grep -rhoaE '\$[a-zA-Z_]+\s*:\s*(Int|String|Boolean|\[)' js | head

# FormData / multipart
grep -rhoaE 'FormData|\.append\(' js | head

# 경로 매개변수
grep -rhoaE 'path:\s*"/[^"]*:[^"]+"' js | head
grep -rhoaE 'useParams|route\.params|\$route\.params' js | head
```

### J3. 검증 게이트 — 필수 / 형식 / enum

```bash
grep -rhoaE '(required|message|pattern|enum|validator)\s*:' js | head
grep -rhoaE 'yup\.|zod\.|async-validator|Form\.Item|a-form-item|el-form-item' js | head
grep -rhoaE 'rules\s*:\s*\[|name:\s*["\'][a-zA-Z_]+["\']' js | head
grep -rhoaE 'label.*value|options\s*:\s*\[' js | head
```

### J4. 바인딩 계층 — 폼 → API

```bash
grep -rhoaE 'onFinish|handleSubmit|getFieldsValue|validateFields' js | head
grep -rhoaE '(pick|omit|transform|dayjs|moment)\(' js | head
```

runtime 보완: DevTools → Network → 요청 → **Initiator**(call stack)에서 `fetch`/`send`를 거슬러 올라가 요청 조립 함수를 찾습니다.

### J5. 암호화 매개변수

```bash
grep -rhoaE 'encrypt|decrypt|sign|CryptoJS|sm2|sm3|sm4|RSA|AES' js | head
```

**암호문에서 필드를 추측하지 않습니다** — 암호화 함수의 **입력**을 Hook하여 암호화 전 plaintext payload를 기록하고, 결론을 `config.json` / `param_candidates.json`에 씁니다.

### J6. 매개변수 트리거 매트릭스(Phase 3 필수)

각 모듈에서 작업별로 한 번 기록하고 요청 body/query를 diff합니다:

| 작업 | 확인할 것 |
|---|---|
| 목록 첫 화면 | 기본 페이지네이션 값 |
| 검색 | keyword、filters |
| 고급 필터 | optional 필드 |
| 생성/편집 | 완전한 entity |
| 일괄/내보내기 | `ids[]`、`exportType` |
| 정렬/페이지 이동 | `sortField`、`order` |

`param_samples.json` 산출: `[{ "path", "method", "action": "search", "body", "query", "headers" }]`

### J7. 신뢰도 규칙

| 신뢰도 | 조건 |
|---|---|
| **높음** | 정적 callsite + runtime ≥2 샘플일치 |
| **중간** | 정적만 또는 runtime 1회 |
| **낮음** | 응답/오류 역추론이며 2차 검증 없음 |
| **트리거 대기** | 정적으로 아는 필드지만 UI/권한에 도달하지 않음 |

### J8. 시나리오 빠른 조합

| 시나리오 | 순서 |
|---|---|
| REST 목록 페이지 | J1 요청 조립 객체 → J6 4회 diff → J3 rules |
| 생성/수정 폼 | J3 Form name → J4 submit 체인 → runtime 제출 + 일부러 비워 400 확인 |
| GraphQL | J2 variables 선언 → runtime 각 operation의 variables 기록 |
| 암호화 body | J5 입력 Hook → 암호화 전 필드가 실제 params |

### J9. api-recon 단계와의 매핑

| api-recon | 매개변수 recon |
|---|---|
| Phase 1 정적 | J1 앵커 확장 |
| Phase 2 A2 interceptor | 전역 주입 필드(tenantId, sign) |
| Phase 3 runtime | J6 트리거 매트릭스 + `param_samples.json` |
| Phase 4 권한 트리 | 모듈별 폼이 다름 → 권한이 있어야 전체 필드 트리거 |
| Phase 5 병합 | `params_merged.json` + 신뢰도; 단일 샘플로 필수 확정 금지 |

### J10. 장애 해결

| 현상 | 처리 |
|---|---|
| 정적 필드명이 있으나 runtime에 나타나지 않음 | 「트리거 대기」표시; 권한 트리 보완 / 고급 필터 클릭 / 연동 select의 각 option |
| 동일 path의 body 형태가 다름 | 정상 — `action`별로 기록하고 schema를 억지로 병합하지 않음 |
| stub 응답은 가짜지만 params를 보고 싶음 | **outbound 요청** body/headers를 확인하고 stub 응답에서 역추론하지 않음 |
| 400이 nested field를 보고함 | 외부 wrapper `data`/`bizData`/`variables` 주의 |
| GraphQL에 operation 이름만 보임 | `variables` JSON을 펼치고 정적으로 `$var: Type` 검색 |

---
