# api-recon — reference manual

Grep recipes, the `config.json` template, and troubleshooting. Run all grep commands against the `js/` directory. When a bundle is one line, first use `js-beautify` or `sed 's/}/}\n/g'`; raw grep with a context window is usually sufficient.

## Script notes

All files in `scripts/` are **reference templates** and must be adapted for the target site before execution. Common change points:

| Script | Common required changes |
|---|---|
| `harvest_static.py` | endpoint regex, webpack/Vite manifest parsing, micro-frontend publicPath, retry/concurrency |
| `runtime_harvest.js` | neutralize field names and success values, stub matching rules and body shape, route source, WS recording, `waitUntil`/`routeTimeout`/`proxy` |
| `preload.js` | `loginPathRe`, L1 stubs, `neutralize.fields`, `apiPattern`, whether to enable L3, `recordDetail`, `observe.*`, `neutralizeVueRouter` |
| `spider_mpa.py` | destructive `--exclude` links, cookie, depth/max, same-origin filtering |
| `extract_route_map.py` | `routeMap` / `routeLink` regex, KEY naming pattern |
| `build_perm_tree.py` | `userRouteAuth` parsing, `ROOTS`/`PREFIX_PARENT` hierarchy heuristics, stub outer field names |
| `config.json` | unified entry point for all the site-specific parameters above |

Place adapted files in the task working directory (such as `recon/`) and document the concrete changes from the reference scripts in the report.

---

## A. Reverse-engineering the three gates

### A1. Rendering gate — “How is logged-in status determined?”

```bash
grep -rhoaE '.{0,40}(isLogin|isAuthenticated|loggedIn|hasLogin|requireAuth)\b.{0,80}' js | head
grep -rhoaE 'function (getUser|getToken|getAuth)[0-9]?\([^)]*\)\{.{0,200}' js | head
grep -rhoaE '(localStorage|sessionStorage)\.getItem\("[^"]+"\)' js | sort -u
grep -rhoaE '(Cookies?|cookie)\.(get|load)\("[^"]+"\)' js | sort -u
grep -rhoaE '\batob\(|JSON\.parse\(|jwt|decode' js | head
```

Trace the chain `isLogin = f(getUser())` → `getUser = decode(storage.read(KEY))` and determine the **storage key**, **container** (Cookie versus localStorage), and **encoding**:

| Encoding | Config forgery |
|---|---|
| Plain string / `"1"` / token | `"value": "anything-truthy"` |
| `JSON.parse(x)` | `"value": "json:{\"id\":1,\"username\":\"admin\"}"` |
| `JSON.parse(atob(x))` | `"value": "b64json:{\"id\":1,\"username\":\"admin\"}"` |
| JWT | unsigned/`alg:none` JWT, or sign with a bundle key |
| Encryption (SM2/AES/RSA) | Find the hard-coded key; forge when the rendering gate only needs a decodable blob; otherwise use a static fallback |

→ Write the result to `cookies` / `localStorage`.

### A2. Interceptor gate — “What triggers a redirect to /login?”

```bash
grep -rhoaE '.{0,60}(interceptors\.response|axios|request\.use).{0,120}' js | head
grep -rhoaE '.{0,40}(response_code|errcode|errno|\bcode\b|\bret\b|\bstatus\b)\s*[=!]==?\s*[\-0-9]{1,4}.{0,60}' js | head -20
grep -rhoaE '.{0,40}(not\s*logged?\s*in|please\s*log\s*in|session\s*expired|unauthorized|access\s*denied|token.{0,10}invalid).{0,40}' js | head
grep -rhoaE '.{0,30}(location\.href|router\.(push|replace)|navigate)\([^)]*login[^)]*\)' js | head
```

Determine the **field name**, **success value** (usually `0` or `200`), and **failure value that triggers the redirect**. Verify with a junk session:

```bash
curl -sk -X POST -H 'Cookie: <fakekey>=junk' https://target/api/<protected> -d '{}' -H 'Content-Type: application/json'
```

→ Write `neutralize.fields` + `neutralize.success`.

### A3. Content gate — “Where do menus/permissions come from?”

```bash
grep -rhoaE '"/api[^"]*(permission|perm|role|menu|acl|resource|nav)[^"]*"' js | sort -u
grep -rhoaE '.{0,30}(menus|permissions|menuList|routeList|authList|role_permissions)\b.{0,120}' js | head
grep -rhoaE 'userRouteAuth|getResultTree|routeMap|routeLink|hasPermission|checkAuth' js | head
grep -rhoaE '([A-Z_][A-Z0-9_]*):\{name:"[^"]*",link:"/[^"]+"\}' js | head
```

**Two-layer data** (common in enterprise back offices):

| API | Typical payload | Consumer |
|---|---|---|
| `.../role_permissions` | `{ permissions: string[], role_type }` | route guards, button-level ACL |
| `.../permissions/all` | `tree[{ code, position, children }]` | sidebar rendering |
| bundle `userRouteAuth` | `{ CODE: { url, name? } }` | code → front-end path |
| bundle `routeMap` | `{ KEY: { name, link } }` | alias resolution (webpack `o.DASHBOARD`) |

Read the consumer code to confirm how `getResultTree(tree, permissions)` filters and which field the `v-if` / `hasAuth(code)` check.

**Manual forge** (small sites): build a permissive payload → `stubs`.

**Complete permission-tree restoration** (large sites where the sidebar/submodules remain blank): see **section I**.

---

## B. config.json template

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

Field descriptions:
- `runtimeMode`: `depth` (Puppeteer), `coverage` (browser MCP), or `both`
- Prefixes for `cookies[].value`: `b64json:` → base64(JSON); `json:` → raw JSON; no prefix → literal
- `forward: true` forwards real requests and rewrites code fields; `false` is fully offline stubbing
- `mockTier`: layers enabled by the coverage-mode preload, such as `L1+L2` and `L1+L2+L3`
- `routes` comes from `routes.txt`; after forging menus, the harness automatically appends `<a href>`
- `captureResponses` / `recordWs` are effective only in depth mode
- `waitUntil`: use `domcontentloaded` for large SPAs to avoid `networkidle2` hanging
- `routeTimeout`: single-route `page.goto` timeout in milliseconds
- `proxy`: Puppeteer `--proxy-server`; you can also set `HTTP_PROXY` / `HTTPS_PROXY`

### B1. Dual-stub template (role_permissions + permissions/all)

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

Outer field names (`response_code` / `code` / `data`) must match the interceptor gate in A2; `permissions` must cover every leaf code in the tree.

---
+
## C. Coverage mode: preload configuration

Edit the `CONFIG` object at the top of `scripts/preload.js`, or replace it before CDP injection:

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
  stubs: [ /* same stubs as config.json */ ],
  apiPattern: /\/(api|apis|v\d+|dev|internal|graphql)\//i,
};
```

Verify `window.__API_RECON_PRELOAD__ === true` and a stable pathname.

Export recording results:

```javascript
JSON.stringify({
  apis: [...window.__API_RECON_LOG__],
  detail: window.__API_RECON_DETAIL__,
  routes: [...(window.__API_RECON_ROUTES__ || [])],
  observe: window.__API_RECON_OBSERVE__,
}, null, 2)
```

---

## D. preload / runtime Hook capabilities

Built-in browser Hook capabilities and coverage in preload (coverage) and runtime_harvest (depth):

| Hook capability | Value for API discovery | Coverage |
|---|---|---|
| Hook fetch / XHR.open | record request URL/method | ✅ `recordDetail` + `__API_RECON_LOG__` |
| Hook XHR.setRequestHeader | discover Authorization and other headers | ✅ `observe.xhrHeaders` |
| Hook localStorage/cookie reads | confirm the session key name | ⚠️ optional `observe.storageReads/cookieReads` |
| Vue route acquisition | complete frontendRoutes | ✅ `__API_RECON_ROUTES__` (loaded routes) |
| Neutralize Vue route guards / block login redirects | open module-triggered APIs | ✅ `neutralizeVueRouter` + native-navigation neutralization |
| React route acquisition | complete routes | ⚠️ static + clicks; no dedicated Hook |
| Block page navigation (login path) | keep the page for analysis | ⚠️ block login paths only; avoid blocking business navigation |
| Hook crypto libraries (CryptoJS/SM, etc.) | encrypted parameters → plaintext API body | ❌ manually Hook the encryption-function input; record the conclusion in config |
| Anti-debug bypass | otherwise runtime cannot record APIs | ❌ manual handling required; static analysis remains available |

---

## E. Endpoint extraction regex (when static output is too small)

Broaden `extract_endpoints` in `harvest_static.py`, or run manually:

```bash
grep -rhoaE '"/[a-z][A-Za-z0-9_/\-]{3,}"' js | sort -u
grep -rhoaE '/api/[a-zA-Z0-9_./-]+' js | sort -u
```

---

## F. Troubleshooting

| Symptom | Cause → handling |
|---|---|
| Very few static APIs | endpoint dialect mismatch → broaden the regex (section E) |
| Chunk count ≪ manifest | CSS-only chunk or undeployed chunk; 404s have been retried |
| Runtime still shows the login page | rendering gate is wrong → recheck A1: key name, container, encoding, domain |
| Shell entered but module is blank | content gate → forge menus (A3); `routes` paths may be wrong |
| Every route has only bootstrap/locale | permission codes incomplete → restore the permission tree in I; check the dual `role_permissions` + `permissions/all` stubs |
| Sidebar has an item but the child page is blank | tree is missing an intermediate node or code disagrees with `userRouteAuth` |
| Every API redirects to login | interceptor gate → confirm `neutralize`; extend walk logic for nested fields |
| WS frames are 0 | subscription requires user interaction; increase `perRouteMs` |
| Response body is empty | real responses exist only when `forward: true` |
| Chromium is missing | install Chromium or set `config.chromium` / `CHROMIUM` |
| Many mocks still return to login | Hook ran too late or lacks a `location.href` setter → document-start + preload |
| Lists are all empty | L3 empty arrays are normal; continue clicking tabs/settings/details |
| A Redux action was mistaken for a route | filter internal paths containing get/set/change/clear/toggle/upload |
| Vue still redirects to login | preload is not document-start → change injection timing; or manually clear guards when `neutralizeVueRouter: false` |
| A response contains a URL but it is not in the log | enable `extractUrlsFromResponse`; or extract manually from `__API_RECON_DETAIL__` |
| Authorization header name is unknown | enable `observe.xhrHeaders` or inspect request headers in DevTools |
| Runtime is very slow / times out | use `waitUntil: domcontentloaded`; lower `routeTimeout`; do not use `networkidle2` |
| Proxy connection fails | check `proxy` / environment variables; Puppeteer and curl proxy ports must match |

---

## G. Hardened targets

When the server progressively validates sessions (an unforgeable signed cookie, or server-rendered menus that cannot be stubbed), runtime may stop at the shell. Expected behavior:

- **Static analysis is sufficient for endpoint enumeration** — module paths are in the code
- If authorized, run the same harness with a **real session**: `forward: true`, no neutralize, and capture real methods/parameters/responses

---

## H. Single-task checklist

1. Confirm authorization scope
2. **Read** `scripts/harvest_static.py` → adapt for the target → run → review `api_static.txt` and `routes.txt`
3. **Phase 1b**: expand path anchors + binding layer → `param_candidates.json` (section J)
4. Reverse A1/A2/A3 → write the site-specific `config.json`
5. **Read and adapt** `runtime_harvest.js` / `preload.js` before execution
6. `runtimeMode=depth`: `npm install` → run the adapted harvest script
7. `runtimeMode=coverage/both`: inject the adapted preload at document-start → browser MCP dynamic enumeration + **parameter trigger matrix**
8. If a module does not render → **restore the permission tree in section I** → patch stubs → rerun
9. Diff parameter samples + infer errors → `params_merged.json`
10. Merge → `site_map.json` + `api_merged.txt`, honestly state coverage, gaps, and script changes

---
+
## I. Permission-tree restoration (Phase 4 deep dive)

Use this when a simple forge such as `menus: [{ path, show: true }]` is ineffective and submodules still do not mount.

### I1. Locate the auth module

```bash
grep -l 'userRouteAuth' js/*.js
grep -l 'routeMap\|routeLink' js/*.js
grep -rhoaE 'getResultTree|role_permissions|permissions/all' js | head
```

Record the **permission API path**, **response field names**, and **consumer chunk filename**.

### I2. Extract routeMap

```bash
python3 scripts/extract_route_map.py recon/js recon/
# produces recon/route_map.json
```

If `[!] no routeMap pattern found` appears, broaden the regex in `extract_route_map.py` or grep manually:

```bash
grep -rhoaE '([A-Z_][A-Z0-9_]*):\{name:"[^"]*",link:"/[^"]+"\}' js | head -20
```

### I3. Build the permission tree + stub

```bash
python3 scripts/build_perm_tree.py recon/js recon/ --config recon/config.json
```

Script logic:
1. Parse `userRouteAuth={MONITOR:{url:...},...}` (including the webpack alias `He=o.DASHBOARD`)
2. Use `route_map.json` to resolve aliases → real paths
3. Infer parents from code prefixes (such as `MONITOR_ALERT` → `MONITOR`)
4. Output `permissions_tree.json`, `permissions_all_stub.json`, and `role_permissions_stub.json`
5. With `--config`, automatically write `config.json`'s `stubs` and extend `routes`

**Adjust for the target** (at the top of the script):
- `DEFAULT_ROOTS`: list of top-level module codes
- `DEFAULT_PREFIX_PARENT`: `PREFIX_` → parent mapping
- `DEFAULT_EXTRA_PARENT`: orphan nodes whose relationship is not a prefix

### I4. Validate stub consistency

```bash
# permissions count should be approximately the number of userRouteAuth entries
wc -l recon/perm_codes_all.txt
# routes should cover every link in route_map
python3 -c "import json; m=json.load(open('recon/route_map.json')); r=set(json.load(open('recon/config.json'))['routes']); print('missing', [v['link'] for v in m.values() if v['link'] not in r])"
```

### I5. Rerun runtime and compare

```bash
node recon/runtime_harvest.js recon/config.json
# compare runtime_api.json counts before and after forging; check whether module APIs such as /attack and /asset appear
```

| Before forge | After forge (success) |
|---|---|
| Every route has the same 3–5 bootstrap calls | Different routes trigger different module APIs |
| Only `/api/locale/language` | Module endpoints such as `/api/web/...` appear |
| `routes.txt` has single-digit routes | `routes` has 80–110+ entries from route_map |

### I6. If it still fails

- **Coverage mode**: click the sidebar + tabs; permission gating may request data only after interaction
- **Stub fields**: compare the real API (curl + real session) with stub nesting
- **Additional guards**: grep `hasPermission|checkRole|func.` and similar button-level checks; extend `role_permissions.permissions`
- **Static fallback**: module API paths are still in `api_static.txt`; runtime only adds METHOD/body; retain parameters in `param_candidates.json` + recorded samples

---

## J. Parameter reverse engineering (Phases 1b / 5b / 5c)

**Methodology, not a universal script.** Find paths with regex; find parameters with anchor expansion + UI binding chains + multi-sample diffs + error inference.

### J1. Anchor expansion — find the request-building object from a path

```bash
# use a path known from Phase 1 as the anchor
grep -n '"/api/user/list"' js/*.js
grep -rhoaE '.{0,120}("/api[^"]+").{0,200}' js | head
grep -rhoaE '(params|data|body|payload)\s*:\s*\{' js | head
grep -rhoaE '(get|post|put|delete|patch)\([^,]+,\s*\{' js | head
```

### J2. Wrapper layers and transport forms

```bash
# axios / unified request
grep -rhoaE '(axios|request)\.(get|post|put|delete|patch)\(' js | head
grep -rhoaE 'interceptors\.(request|response)' js | head

# GraphQL
grep -rhoaE '(query|mutation)\s+\w+|gql`|graphql\(' js | head
grep -rhoaE '\$[a-zA-Z_]+\s*:\s*(Int|String|Boolean|\[)' js | head

# FormData / multipart
grep -rhoaE 'FormData|\.append\(' js | head

# path parameters
grep -rhoaE 'path:\s*"/[^"]*:[^"]+"' js | head
grep -rhoaE 'useParams|route\.params|\$route\.params' js | head
```

### J3. Validation gate — required fields / format / enum

```bash
grep -rhoaE '(required|message|pattern|enum|validator)\s*:' js | head
grep -rhoaE 'yup\.|zod\.|async-validator|Form\.Item|a-form-item|el-form-item' js | head
grep -rhoaE 'rules\s*:\s*\[|name:\s*["\'][a-zA-Z_]+["\']' js | head
grep -rhoaE 'label.*value|options\s*:\s*\[' js | head
```

### J4. Binding layer — form → API

```bash
grep -rhoaE 'onFinish|handleSubmit|getFieldsValue|validateFields' js | head
grep -rhoaE '(pick|omit|transform|dayjs|moment)\(' js | head
```

Runtime supplement: DevTools → Network → request → **Initiator** (call stack); trace upward from `fetch`/`send` to the request-building function.

### J5. Encrypted parameters

```bash
grep -rhoaE 'encrypt|decrypt|sign|CryptoJS|sm2|sm3|sm4|RSA|AES' js | head
```

**Do not guess fields from ciphertext** — Hook the encryption function's **input**, record the plaintext payload before encryption, and write the conclusion to `config.json` / `param_candidates.json`.

### J6. Parameter trigger matrix (required in Phase 3)

Record each operation once per module and diff request body/query:

| Operation | What to watch |
|---|---|
| Initial list | default pagination values |
| Search | keyword, filters |
| Advanced filtering | optional fields |
| Create/edit | complete entity |
| Bulk/export | `ids[]`, `exportType` |
| Sort/page | `sortField`, `order` |

Output `param_samples.json`: `[{ "path", "method", "action": "search", "body", "query", "headers" }]`

### J7. Confidence rules

| Confidence | Condition |
|---|---|
| **High** | static callsite + ≥2 matching runtime samples |
| **Medium** | static only, or one runtime sample |
| **Low** | response/error inference without a second verification |
| **Pending trigger** | field is known statically, but the UI/permission path was not reached |

### J8. Fast scenario recipes

| Scenario | Order |
|---|---|
| REST list page | J1 request-building object → four J6 diffs → J3 rules |
| Create/edit form | J3 Form name → J4 submit chain → runtime submit + intentionally leave blank to observe 400 |
| GraphQL | J2 variable declarations → record variables for each runtime operation |
| Encrypted body | J5 Hook input → fields before encryption are the real parameters |

### J9. Mapping to api-recon phases

| api-recon | Parameter recon |
|---|---|
| Phase 1 static | J1 anchor expansion |
| Phase 2 A2 interceptor | globally injected fields (tenantId, sign) |
| Phase 3 runtime | J6 trigger matrix + `param_samples.json` |
| Phase 4 permission tree | forms differ by module → sufficient permissions are needed to trigger all fields |
| Phase 5 merge | `params_merged.json` + confidence; do not determine required status from one sample |

### J10. Troubleshooting

| Symptom | Handling |
|---|---|
| Field name exists statically but never appears at runtime | mark “pending trigger”; restore the permission tree / click advanced filters / try every linked select option |
| Same path has different body shapes | normal — record separate entries by `action`; do not force one schema |
| Stub response is fake but parameters are needed | **Inspect the outbound request** body/headers; do not infer from the stub response |
| 400 reports a nested field | pay attention to outer `data`/`bizData`/`variables` wrappers |
| GraphQL shows only the operation name | expand the `variables` JSON; search statically for `$var: Type` |

---
