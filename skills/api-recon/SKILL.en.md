---
name: api-recon
description: Use this skill when collecting website API endpoints.
---

# API Recon (front-end endpoint reconnaissance)

Under **authorized** conditions, discover as completely as possible: **backend APIs** (paths, methods, parameters, response bodies), **front-end routes**, and **UI feature trigger points** (tabs, dialogs, table operations, and so on).

---

## Scope and prohibitions (Agent must read · violation is out of scope)

This skill **only performs API/parameter-surface reconnaissance**; it is not a vulnerability-discovery or exploitation phase.

### Task boundaries

| Scope | Allowed | Prohibited |
|---|---|---|
| **Target** | Enumerate paths, methods, parameters, routes, and UI trigger points | SQLi/XSS/authorization bypass/brute force/fuzzing vulnerabilities, packet modification attacks, destructive operations |
| **Authentication** | Use Hook + stub/mock to bypass the **client-side** login gate | Ask the user for or guess usernames and passwords; attempt submission of a real login form |
| **Runtime** | Hook interfaces without credentials and use mock responses to let the SPA enter its post-login shell | Processes that can continue only with a real backend session |

### Credential-free dynamic analysis (Phase 3 default)

1. Use `preload.js` / `runtime_harvest.js` to **intercept and stub** bootstrap interfaces such as login, permissions, and menus;
2. Return mock bodies with a **correct structure, a successful business code, and data that may be empty** for business query interfaces;
3. Let the front end render post-login pages without a backend or in a 401 environment, thereby triggering more XHR/fetch/WebSocket requests;
4. **Empty data, blank tables, and placeholder UI are all expected**—do not turn to real login or vulnerability testing for this reason.

**In one sentence**: use mocks to open up front-end routes and component mounting, **record outbound requests only**; what the backend returns is unimportant—the important question is which interfaces the front end **continues to send**.

### Hard workflow prohibitions

| Prohibited | Alternative |
|---|---|
| Before Phase 1 is complete, grep/curl/Read the main entry `index-*.js` to extract API paths | Run `OUTDIR/harvest_static.py` |
| Write a custom `extract_apis.py` or similar script instead of using harvest | Modify `OUTDIR/harvest_static.py` and rerun it |
| Repeat the same grep/command after it has failed ≥2 times | Change strategy: read tool_logs, modify harvest, or consult the reference |
| Skip gates A/B and run the original `scripts/` directly | Copy it into OUTDIR and adapt it for the target |
| Real usernames/passwords, OTP, OAuth, or other authentication | Use stub/mock (see above) |
| Skip stubbing and perform authorization-bypass/injection testing on the grounds of “getting real data” | Record outbound requests only; this is the recon boundary |
| Delete data, export sensitive data, perform bulk writes, or other irreversible operations | The same applies to coverage clicks |
| Claim to have obtained all pages and interfaces without completing runtime + dynamic enumeration | See “Definition of done” or state the limitation |
| Claim to understand all parameters without completing the parameter trigger matrix + diff | Phase 3b matrix + Phase 5 diff |
| Infer required/optional status from a single runtime sample | Multi-sample diff or validation-rule/error inference |

---

## Two-layer model + runtime modes

| Layer | Output | Limit |
|---|---|---|
| **Static** (JS bundle) | All endpoint paths, route draft, candidate fields at request-building sites | No HTTP methods; parameters require Phase 1b; runtime-constructed URLs can be missed |
| **Runtime** (live session) | Methods + bodies + responses + dynamic URLs + WS/SSE; multi-sample diffs complete parameters | The page must actually render before it sends requests; one sample is insufficient to determine required/optional status |

| Runtime mode | Engine | Use |
|---|---|---|
| **depth** | `runtime_harvest.js` (Puppeteer) | API inventory, METHOD/parameters/response bodies, WS/SSE, reproducible batch runs |
| **coverage** | browser + `preload.js` | Click tabs/dialogs/tables for deeper feature-point coverage |
| **both** | depth first, then coverage | Most complete, longest runtime |

**Parameter methodology** (no universal script): use harvest/regex for paths; use **anchor expansion + UI binding chain + multi-sample diff + error inference** for parameters (see the grep recipes in section J of [reference.en.md](reference.en.md)).

---

## Definition of done

Claim recon complete only when all items are satisfied:

- [ ] **Static**: Phase 1 harvest produces `api_static.txt`, `routes.txt`, and `js/`
- [ ] **Runtime**: at least depth or coverage; coverage/both requires **the Hook to work + the dynamic enumeration loop**
- [ ] **Enter the shell**: visiting a business path does not result in `/login` (pay attention to hash routes)
- [ ] **Parameters**: coverage/both completes the parameter trigger matrix + `param_samples.json`; Phase 5 merges `params_merged.json`
- [ ] **Depth** (if a module page is blank): restore the permission tree in Phase 4 and rerun until **module-level APIs** appear (not only locale/bootstrap)
- [ ] **Delivery**: Phase 5 outputs are complete (see the Phase 5 output table); `insert_assets` writes service and endpoint assets

---

## Scripts and gates

The files in `scripts/` are reference templates only; **do not run the originals directly and treat their output as final**.

**Rule**: read first → adapt for the target → write into `OUTDIR` (such as `recon/`) → record `CHANGES.md`; if it does not match, rewrite according to the methodology and borrow structure only.

| Gate | When | Reference script → OUTDIR copy | Common required changes |
|---|---|---|---|
| **A (static)** | After Phase 0, before the **first** harvest/spider run | `harvest_static.py` / `spider_mpa.py` | **The default regex works directly on most sites**; change endpoint regex, webpack/Vite `publicPath`, or MPA exclude/cookie only when the manifest/dialect does not match |
| **B (runtime)** | After Phase 2, before running depth/coverage | `runtime_harvest.js` / `preload.js` + `config.json` | Cookie/localStorage keys, neutralize success value, stubs, login regex, API prefix, hash/history |

**Mandatory SPA order** (not interchangeable; Phase numbering takes priority over “explore first, then script”):

| Step | Required | Prohibited |
|---|---|---|
| After Phase 0 is complete | The next Bash command = `python3 OUTDIR/harvest_static.py <URL> OUTDIR` | curl/grep/Read the main entry `index-*.js` (usually >500KB) |
| Gate A | Copy the script → make small changes as needed → **run immediately** | Manually extract APIs before deciding whether to harvest |
| Before Phase 1 is complete | Validate outputs with `wc -l`; fix 404s by modifying harvest and retrying | Write an extract script; repeatedly grep URLs that were not downloaded |
| From Phase 1b | grep only `OUTDIR/js/*.js` | Use the main bundle instead of harvest |

- ✅ Copy `harvest_static.py` → (optionally) change the regex → **run immediately**
- ❌ curl the main bundle → grep repeatedly → write a temporary extractor → harvest only at the end
- **MPA**: after Phase 0, the next Bash command = `python3 OUTDIR/spider_mpa.py ...`

---

## Tool and output constraints

| Constraint | Description |
|---|---|
| Large files | **Do not** Read/grep `index-*.js` files >100KB into context; batch-process them with OUTDIR scripts |
| grep output | Must use `\| head -20` or `-m 5`; keep only path summaries in the conversation and do not paste bundle snippets |
| Validation | Use `wc -l` and `ls \| wc -l`; do not Read the entire directory |
| Initial regex probe | Optional, ≤1 time, only on a small chunk or HTML ≤50KB; use harvest as the authoritative static result |
| Reference | Recipes/templates/troubleshooting are in [reference.en.md](reference.en.md); do not duplicate the full text inline |
+
---

## Execution roadmap

```
Phase 0 classification + OUTDIR
  → Gate A → Phase 1 harvest (★ run immediately ★)
  → Phase 1b parameter reverse engineering
  → Phase 2 three authentication gates → config.json
  → Gate B → Phase 3 runtime + parameter matrix
  → Phase 4 permission tree (when necessary) → rerun Phase 3
  → Phase 5 merge report + insert_assets: bulk-insert every discovered service and endpoint API asset; never omit a discovered asset during insertion
```

Check items in order; **do not enter the next Phase until the previous item is complete**.

1. [ ] **Phase 0**: initial SPA/MPA probe; create `OUTDIR` → [Phase 0](#phase-0--classification)
2. [ ] **Gate A + Phase 1**: copy the script → **harvest immediately** → validate with `wc -l` → [Phase 1](#phase-1--static)
3. [ ] **Phase 1b**: anchor expansion + binding layer → `param_candidates.json` → [Phase 1b](#phase-1b--parameter-reverse-engineering)
4. [ ] **Phase 2**: three authentication gates → `config.json` → [Phase 2](#phase-2--three-authentication-gates)
5. [ ] **Gate B**: adjust the runtime script → [Phase 3](#phase-3--runtime)
6. [ ] **Phase 3**: depth / coverage / both; confirm shell entry; parameter trigger matrix → `param_samples.json`
7. [ ] **Phase 4** (if needed): permission tree → patch stubs → rerun Phase 3 → [Phase 4](#phase-4--permission-tree-restoration)
8. [ ] **Phase 5**: merge outputs + report + `insert_assets` → [Phase 5](#phase-5--merge-and-report)

---

## Phase 0 — Classification

Fetch the entry HTML and **create `OUTDIR`** (do not modify the skill's `scripts/`):

- **SPA**: shell + `<div id=app>` + chunks → Phases 1–5
- **MPA**: SSR + `<form>`, no endpoint bundle → after Gate A:

```bash
python3 recon/spider_mpa.py <BASE_URL> <OUTDIR> [--cookie "session=..."] [--max 300] [--depth 5] [--exclude "logout|delete|destroy"]
```

Produces `forms.txt`, `links.txt`, and `api_inline.txt`. If an SPA has approximately zero forms, switch to Phase 1.

---

## Phase 1 — Static

Follow [Scripts and gates](#scripts-and-gates) · [Tool and output constraints](#tool-and-output-constraints).

```bash
python3 recon/harvest_static.py <BASE_URL> <OUTDIR>
```

harvest parses HTML scripts → the webpack/Vite manifest → all lazy chunks, producing `js/`, `api_static.txt`, `routes.txt`, and `chunkmap.txt`.

```bash
wc -l OUTDIR/api_static.txt OUTDIR/routes.txt
ls OUTDIR/js | wc -l
```

- Chunk count vs. manifest: for 404s, modify harvest and retry; do not manually curl chunks one by one
- `api_static.txt` too short → broaden the endpoint regex inside OUTDIR and rerun (see reference)

### Phase 1b — Parameter reverse engineering

Paths come from Phase 1; parameter fields require separate recon. See [Tool and output constraints](#tool-and-output-constraints) for grep rules.

**Completion standard**: for every important interface, answer the field names, transport location, inferred type, required/optional status, sample value, and confidence.

#### 1b.0 — Transport form

| Form | Where parameters are | What to inspect first statically |
|---|---|---|
| REST JSON | body + query | beside the path anchor `(params\|data\|body)\s*:\s*\{` |
| GraphQL | `variables` | gql template, `$page: Int` |
| Traditional form | urlencoded | `<form>`, `FormData` |
| File upload | multipart | `FormData.append` |
| Path parameter | `/user/:id` | route table + `useParams` / `$route.params` |
| Encryption/signature | wrapped in `sign`/`data` | hook the encryption function input (reference D) |

Output: label each interface `transport: query|json|form|graphql|encrypted`.

#### 1b.1 — Anchor expansion

Use a known path as an anchor and expand the window to find the request-building object:

```bash
grep -n '"/api/user/list"' OUTDIR/js/*.js | head -20
grep -rhoaE '.{0,120}("/api[^"]+").{0,200}' OUTDIR/js/*.js | head -20
grep -rhoaE '(params|data|body|payload)\s*:\s*\{' OUTDIR/js/*.js | head -20
```

| Wrapper layer | Parameter clues |
|---|---|
| axios instance | `data` / `params` |
| Unified request | interceptor-injected global fields |
| OpenAPI client | generated method signature |
| React Query / SWR | second hook argument |
| Vue composable | composable argument |

Type remnants: `yup`/`zod`/rules, `Form.Item name=`, and embedded Swagger.

→ `param_candidates.json`: `{ path, fields[], source: "static-callsite", confidence }`

#### 1b.2 — Binding layer

```
Form field → onFinish/handleSubmit → transform → API payload
```

| Binding source | Technique |
|---|---|
| Form submit | follow submit → transform → API |
| Table search | `getFieldsValue()` → `params` |
| Route | `:id` / `?tab=` |
| Interceptor | global `tenantId`, pagination, sign |
| Enum select | `options` → API enum value |

Trace upward from `fetch`/`XHR.send` in the DevTools call stack to find the request-building function.

#### 1b.3 — Three request-building questions (≠ Phase 2 three authentication gates)

| Question | What to answer |
|---|---|
| **Assembly** | Where is the payload built; are there transform traces? |
| **Validation** | required, pattern, enum |
| **Transport** | path / query / body / multipart / header |

The interceptor gate (Phase 2) also reveals globally injected fields (Authorization, `X-Tenant-Id`, and sign).

#### 1b.4 — Connect to Phase 3

Candidate fields come from the static/binding layer; **required/optional/conditional dependencies** require the Phase 3 parameter matrix + diff + Phase 5 error inference.

---

## Phase 2 — Three authentication gates

Grep `OUTDIR/js/` (with `head`) and write `config.json` (see the recipes in the reference):

| Gate | Question | Keywords |
|---|---|---|
| **Rendering gate** | How is logged-in status determined? | `isLogin`, `getToken`, Cookie/localStorage |
| **Interceptor gate** | What triggers a redirect to `/login`? | `response_code`, `errno`, axios interceptor |
| **Content gate** | Where do menus/permissions come from? | `menu`, `permission`, `role`, `acl`, `routes` |

Do not treat a localStorage key as a credential; confirm it from the chunk/request chain.

**Exit = Gate B**: record conclusions in `config.json` and modify OUTDIR `runtime_harvest.js` / `preload.js`.

### Phase 2b — API observation (optional)

Use OUTDIR's `preload.js` to confirm the session key name, Authorization, and nested API URLs:

| Setting | Output |
|---|---|
| `recordDetail: true` | `__API_RECON_DETAIL__` |
| `observe.xhrHeaders: true` | header observations |
| `extractUrlsFromResponse: true` | child APIs in responses |
| `observe.storageReads/cookieReads: true` | feed values back into config |
| `neutralizeVueRouter: true` | `__API_RECON_ROUTES__` |

Export `__API_RECON_LOG__`, `__API_RECON_DETAIL__`, `__API_RECON_ROUTES__`, and `__API_RECON_OBSERVE__` on every coverage round.

---

## Phase 3 — Runtime

Gate B must be complete. Follow [Scope and prohibitions](#scope-and-prohibitions-agent-must-read--violation-is-out-of-scope) and the credential-free mock strategy.

Set `"runtimeMode": "depth" | "coverage" | "both"` in `config.json` (see the template in the reference).

### Hook and stub (shared by depth + coverage)

| Layer | Scope | Purpose |
|---|---|---|
| L1 exact | auth/permission/bootstrap stubs | pass first-screen authentication |
| L2 negative correction | all JSON responses | change unauthenticated codes to success |
| L3 fallback | unmatched `/api` and similar | empty success body to open up the UI |

- **depth**: fake auth + `forward` business-code rewriting + `stubs`; traverse `routes` (hash/history); produce `runtime_api.json`
- **coverage**: inject `preload.js` at **document-start** (CDP `addScriptToEvaluateOnNewDocument` or a userscript)

Verify that `window.__API_RECON_PRELOAD__` exists and the business path does not return to `/login`.

```bash
cd recon && npm install
node runtime_harvest.js config.json
```

### 3b — Dynamic coverage enumeration (required)

1. Main navigation/sidebar — click each item and wait 1–3s for network activity
2. Tabs — `role=tab`, `.ant-tabs-tab`
3. Tables — inspect the first row: view/edit/details
4. Toolbar — export, filter, create (**avoid irreversible deletion**)
5. On every module entry — merge APIs/routes
6. SPA — controlled `pushState` for paths in `routes.txt` that are not covered (prohibited for MPA)

**Parameter trigger matrix** (required): record each operation type once per module and **diff multiple samples**:

| Operation | Parameters commonly added |
|---|---|
| Initial list | pagination + default filters |
| Click search | keyword, filter |
| Advanced filtering | more optional fields |
| Create/edit | complete entity |
| Bulk/export/sort | `ids[]`, `exportType`, `sortField` |

**Outbound bodies/headers remain real under stubs**—use the request as the source of truth. Record → `scan_raw.json`, `param_samples.json`, `api_detail.json`.

- **Vue**: `neutralizeVueRouter: true` + document-start preload
- **React**: `routes.txt` + sidebar clicks + `pushState`
- **both**: run 3a depth first, then 3b coverage

---

## Phase 4 — Permission-tree restoration

**Trigger**: a module page is blank / each route has only bootstrap (such as locale) → the content gate did not pass.

| Symptom | Meaning |
|---|---|
| Shell entry succeeds | rendering + interceptor gates passed |
| Sidebar item missing/click is blank | stub shape or permission codes are incomplete |
| Every route has the same, very small API set | `v-if permission` did not pass |
| `routes.txt` is far shorter than the bundle | complete it from the auth module |

```bash
grep -rhoaE '"/api[^"]*(permission|perm|role|menu|acl)[^"]*"' OUTDIR/js/*.js | sort -u | head -30
grep -rhoaE 'userRouteAuth|getResultTree|routeMap|routeLink|menuList|authList' OUTDIR/js/*.js | head -20
```

Typical chain: `role_permissions` (flat codes) + `permissions/all` (tree) → `getResultTree` → `userRouteAuth[CODE].url`.

```bash
python3 recon/extract_route_map.py recon/js recon/
python3 recon/build_perm_tree.py recon/js recon/ --config recon/config.json
```

Intermediate outputs: `route_map.json`, `userRouteAuth.json`, `permissions_tree.json`, `*_stub.json`, and `perm_codes_all.txt`.

Stub checks: the outer `response_code` must match the interceptor gate; flat codes and the tree must align; `routes` must cover every link in `route_map`.

After updating `config.json`, **rerun Phase 3**. Large SPAs may need `waitUntil`, `routeTimeout`, and `perRouteMs` adjustments (see reference sections A3/I).
+
---

## Phase 5 — Merge and report

### Output table

| File | Phase | Content |
|---|---|---|
| `js/`, `api_static.txt`, `routes.txt`, `chunkmap.txt` | 1 | static bundles and paths |
| `param_candidates.json` | 1b | static parameter-field candidates |
| `config.json` | 2 | three gates + runtime configuration |
| `runtime_api.json` | 3a | detailed depth recording (including WS/SSE) |
| `param_samples.json`, `scan_raw.json`, `api_detail.json` | 3b | multi-samples, click logs, detail |
| `route_map.json` and related files | 4 | permission-tree intermediates (if executed) |
| `params_merged.json` | 5 | merged parameter fields + confidence |
| `api_merged.txt` | 5 | `METHOD /path [params] [static\|runtime\|both]` |
| `site_map.json` | 5 | routes, APIs, parameters, feature points, limitations |
| **insert_assets** | 5 | write every service and endpoint asset to the asset library |

### 5b — Parameter merge

Diff `param_samples.json`; there is **no universal merge script**. See reference J7 for confidence rules (high/medium/low/pending trigger).

### 5c — Error inference

Within the authorized scope, an incomplete request may be sent to read a 400 (**parameter recon, not vulnerability testing**): `field 'x' is required`, enum errors, and so on. Pay attention to `data` wrappers, `variables`, and pre-encryption `bizData`.

The report must state: runtimeMode, static/runtime API counts, parameter confidence, uncovered modules, and a summary of changes from the reference scripts in `CHANGES.md`.

Suggested `site_map.json` structure:

```json
{
  "site": "https://example.com",
  "runtimeMode": "both",
  "appType": "vue-spa",
  "routeGuardStrategy": ["nav-neutralize", "L1-auth", "L2-patch", "forward"],
  "apisFromStatic": [],
  "apisFromRuntime": [],
  "apis": [],
  "params": [{ "method": "POST", "path": "/api/user/list", "transport": "json", "fields": [] }],
  "frontendRoutes": [],
  "routesVerifiedByClick": [],
  "featuresTriggered": [],
  "limitations": ""
}
```

See [reference.en.md](reference.en.md) for more fields and grep recipes.

---

## General notes

- **Framework-independent**: webpack/Vite/Angular lazy loading use the same method
- **Transport**: REST/JSON, GraphQL, WebSocket, and SSE; gRPC-web is out of scope
- **SSR**: client-side fetches can be recorded; RSC/Server Actions cannot be fully enumerated
- **Blind spots**: JSVMP, WASM, and strict HMAC/mTLS checks → static analysis + state the limitation
- **Parameter blind spots**: conditional dependencies, hidden parameters, and WASM request building → “pending trigger”/“unreachable”
- **Static is the safety net**: when runtime is blocked, static analysis can still enumerate endpoint paths

---

## Additional resources

- Grep recipes, the `config.json` template, troubleshooting, Hooks, parameter reverse engineering section J, and the `site_map` template: **[reference.en.md](reference.en.md)**
- Reference script paths are listed in the [Scripts and gates](#scripts-and-gates) table
