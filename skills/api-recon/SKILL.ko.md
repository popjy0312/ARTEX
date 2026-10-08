---
name: api-recon
description: 웹사이트 API 인터페이스를 수집할 때 호출하는 스킬입니다.
---

# API Recon(프런트엔드 인터페이스 정찰)

**승인된 전제**에서 가능한 한 완전하게 발견합니다: **백엔드 API**(경로, 메서드, 매개변수, 응답 본문), **프런트엔드 라우트**, **UI 기능 트리거**(탭, 대화상자, 테이블 작업 등).

---

## 범위와 금지(Agent 필독 · 위반 시 범위 초과)

이 skill은 **API/매개변수 표면 정찰**만 수행하며 취약점 탐색이나 침투·익스플로잇 단계가 아닙니다.

### 작업 범위

| 범위 | 허용 | 금지 |
|---|---|---|
| **대상** | path, method, 매개변수, route, UI 트리거 열거 | SQLi/XSS/권한 우회/브루트포스/fuzz 취약점, 패킷 변조, 파괴적 작업 |
| **인증** | Hook + stub/mock으로 **클라이언트** 로그인 게이트 우회 | 사용자에게 계정·비밀번호 요청/추측, 실제 로그인 폼 제출 |
| **런타임** | 자격 증명 없이 인터페이스를 hook하고 mock 응답으로 SPA를 로그인 후 셸로 진입 | 실제 백엔드 세션이 있어야 계속되는 흐름 |

### 자격 증명 없는 동적 분석(Phase 3 기본)

1. `preload.js` / `runtime_harvest.js`로 로그인·권한·메뉴 등 bootstrap API를 **가로채고 stub**합니다.
2. 업무 조회 API에는 **구조가 올바르고 업무 코드가 성공하며 데이터는 비어도 되는** mock body를 반환합니다.
3. 백엔드가 없거나 401인 환경에서도 프런트엔드가 로그인 후 페이지를 렌더링하여 더 많은 XHR/fetch/WebSocket을 발생시킵니다.
4. **빈 데이터, 빈 테이블, placeholder UI는 예상된 상태**입니다. 이를 이유로 실제 로그인이나 취약점 테스트로 전환하지 않습니다.

**한 문장 요약**: mock으로 프런트엔드 라우트와 컴포넌트 마운트를 열고 **outbound 요청만 기록**합니다. 백엔드 응답은 중요하지 않고 프런트엔드가 **어떤 인터페이스를 더 요청하는지**가 중요합니다.

### 작업 흐름의 엄격한 금지

| 금지 | 대안 |
|---|---|
| Phase 1 완료 전에 주 entry `index-*.js`를 grep/curl/Read하여 API path 추출 | `OUTDIR/harvest_static.py` 실행 |
| harvest를 대신하는 `extract_apis.py` 등의 스크립트 작성 | `OUTDIR/harvest_static.py`를 수정한 뒤 재실행 |
| 동일 grep/명령이 2회 이상 실패했는데 반복 | 전략 변경: tool_logs를 읽고 harvest를 고치고 reference 확인 |
| Gate A/B를 건너뛰고 `scripts/` 원본 직접 실행 | OUTDIR에 복사해 대상에 맞게 수정 |
| 실제 사용자명/비밀번호, OTP, OAuth 등 인증 | stub/mock 사용 |
| 실제 데이터를 얻겠다며 stub을 건너뛰고 권한 우회/주입 테스트 | outbound만 기록(recon 범위) |
| 민감 데이터 삭제·반출, 대량 쓰기 등 되돌릴 수 없는 작업 | coverage 클릭에도 동일 |
| runtime + 동적 열거 없이 모든 페이지와 API를 얻었다고 주장 | 「완료 정의」를 따르거나 한계 표시 |
| 매개변수 트리거 매트릭스 + diff 없이 모든 매개변수를 파악했다고 주장 | Phase 3b 매트릭스 + Phase 5 diff |
| 단일 runtime 샘플로 필수/선택 추론 | 다중 샘플 diff 또는 검증 규칙/오류 역추론 |

---

## 2계층 모델 + 실행 모드

| 계층 | 산출물 | 한계 |
|---|---|---|
| **정적**(JS bundle) | 전체 endpoint 경로, 라우트 초안, 요청 조립 지점의 후보 필드 | HTTP 메서드 없음; 매개변수는 Phase 1b 필요; 런타임 URL은 누락될 수 있음 |
| **런타임**(활성 세션) | 메서드 + body + 응답 + 동적 URL + WS/SSE; 다중 샘플 diff로 매개변수 보완 | 실제 렌더링된 페이지만 요청; 단일 샘플로 필수/선택 확정 불가 |

| 실행 모드 | 엔진 | 용도 |
|---|---|---|
| **depth** | `runtime_harvest.js`(Puppeteer) | API 목록, METHOD/params/응답, WS/SSE, 재현 가능한 일괄 실행 |
| **coverage** | browser + `preload.js` | Tab/대화상자/테이블 클릭으로 기능 지점 심층 커버 |
| **both** | 먼저 depth, 다음 coverage | 가장 완전하지만 가장 오래 걸림 |

**매개변수 방법론**(범용 스크립트 없음): path는 harvest/정규식, 매개변수는 **앵커 확장 + UI 바인딩 체인 + 다중 샘플 diff + 오류 역추론**으로 찾습니다(grep 레시피는 [reference.ko.md](reference.ko.md) J절).

---

## 완료 정의

모두 충족해야 recon 완료라고 말할 수 있습니다.

- [ ] **정적**: Phase 1 harvest가 `api_static.txt`, `routes.txt`, `js/` 생성
- [ ] **런타임**: depth 또는 coverage 이상 1개; coverage/both는 **Hook 적용 + 동적 열거 루프** 필수
- [ ] **셸 진입**: 업무 path 방문 시 `/login` 아님(hash route 주의)
- [ ] **매개변수**: coverage/both에서 트리거 매트릭스 + `param_samples.json` 완료; Phase 5에서 `params_merged.json` 병합
- [ ] **깊이**(모듈 페이지가 비었을 때): Phase 4 권한 트리 복원 후 module 수준 API가 나타날 때까지 재실행(단순 locale/bootstrap 제외)
- [ ] **납품**: Phase 5 산출물 완비(Phase 5 표 참조); `insert_assets`가 서비스와 endpoint 자산 기록

---

## 스크립트와 Gate

`scripts/`는 참고 템플릿이며 **원본을 직접 실행해 최종 결과로 사용하지 않습니다**.

**규칙**: 먼저 읽기 → 대상에 맞게 수정 → `OUTDIR`(예: `recon/`)에 기록 → `CHANGES.md` 기록. 맞지 않으면 방법론에 따라 다시 쓰고 구조만 활용합니다.

| Gate | 시점 | 참고 스크립트 → OUTDIR 복사본 | 흔한 필수 수정 |
|---|---|---|---|
| **A(정적)** | Phase 0 후, **첫** harvest/spider 전 | `harvest_static.py` / `spider_mpa.py` | **대부분 사이트는 기본 regex로 바로 실행**; manifest/방언 불일치 때만 endpoint 정규식, webpack/Vite `publicPath`, MPA exclude/cookie 수정 |
| **B(런타임)** | Phase 2 후, depth/coverage 전 | `runtime_harvest.js` / `preload.js` + `config.json` | Cookie/localStorage 키, neutralize 성공값, stubs, login 정규식, api prefix, hash/history |

**SPA 강제 순서**(교환 불가; Phase 번호가 ‘먼저 탐색 후 스크립트’보다 우선):

| 단계 | 반드시 | 금지 |
|---|---|---|
| Phase 0 완료 후 | 다음 Bash = `python3 OUTDIR/harvest_static.py <URL> OUTDIR` | curl/grep/Read 주 entry `index-*.js`(보통 >500KB) |
| Gate A | 스크립트 복사 → 필요 시 소폭 수정 → **즉시 실행** | 수동 API 추출 후 harvest 여부 결정 |
| Phase 1 완료 전 | `wc -l`로 검증; 404면 harvest 수정 후 재시도 | extract 스크립트 작성; 미다운로드 URL 반복 grep |
| Phase 1b부터 | grep은 `OUTDIR/js/*.js`만 | 주 bundle로 harvest 대체 |

- ✅ `harvest_static.py` 복사 → (선택) regex 수정 → **즉시 실행**
- ❌ 주 bundle curl → 반복 grep → 임시 extract 작성 → 마지막 harvest
- **MPA**: Phase 0 후 다음 Bash = `python3 OUTDIR/spider_mpa.py ...`

---

## 도구와 출력 제약

| 제약 | 설명 |
|---|---|
| 대용량 파일 | >100KB `index-*.js`는 **Read/grep으로 컨텍스트에 넣지 않음**; OUTDIR 스크립트로 처리 |
| grep 출력 | 반드시 `\| head -20` 또는 `-m 5`; 대화에는 path 요약만, bundle 조각은 금지 |
| 검증 | `wc -l`, `ls \| wc -l` 사용; 전체 디렉터리 Read 금지 |
| regex 초기 탐색 | 선택 사항, ≤1회, ≤50KB chunk 또는 HTML에서만 |
| reference | 레시피/템플릿/장애 해결은 [reference.ko.md](reference.ko.md), 전문 inline 반복 금지 |

---

## 실행 로드맵

```
Phase 0 분류 + OUTDIR
  → Gate A → Phase 1 harvest(★ 즉시 실행 ★)
  → Phase 1b 매개변수 역공학
  → Phase 2 인증 3개 게이트 → config.json
  → Gate B → Phase 3 런타임 + 매개변수 매트릭스
  → Phase 4 권한 트리(필요 시) → Phase 3 재실행
  → Phase 5 병합과 보고서 + insert_assets로 발견한 모든 서비스·endpoint API asset을 일괄 삽입(발견한 asset 누락 금지)
```

순서대로 체크하며 **이전 항목이 끝나기 전에는 다음 Phase로 진행하지 않습니다.**

1. [ ] **Phase 0**: SPA/MPA 초탐색; `OUTDIR` 생성 → [Phase 0](#phase-0--분류)
2. [ ] **Gate A + Phase 1**: 복사 → **즉시** harvest → `wc -l` 검증 → [Phase 1](#phase-1--정적)
3. [ ] **Phase 1b**: 앵커 확장 + 바인딩 계층 → `param_candidates.json` → [Phase 1b](#phase-1b--매개변수-역공학)
4. [ ] **Phase 2**: 인증 3개 게이트 → `config.json` → [Phase 2](#phase-2--인증-3개-게이트)
5. [ ] **Gate B**: runtime 스크립트 조정 → [Phase 3](#phase-3--런타임)
6. [ ] **Phase 3**: depth / coverage / both; 셸 진입 확인; 트리거 매트릭스 → `param_samples.json`
7. [ ] **Phase 4**(필요 시): 권한 트리 → patch stubs → Phase 3 재실행 → [Phase 4](#phase-4--권한-트리-복원)
8. [ ] **Phase 5**: 산출물 병합 + 보고서 + `insert_assets` → [Phase 5](#phase-5--병합과-보고서)

---

## Phase 0 — 분류

진입 HTML을 가져오고 **`OUTDIR`를 생성**합니다(skill 안 `scripts/`는 수정하지 않음).

- **SPA**: 빈 셸 + `<div id=app>` + chunk → Phase 1–5
- **MPA**: SSR + `<form>`, endpoint bundle 없음 → Gate A 후:

```bash
python3 recon/spider_mpa.py <BASE_URL> <OUTDIR> [--cookie "session=..."] [--max 300] [--depth 5] [--exclude "logout|delete|destroy"]
```

`forms.txt`, `links.txt`, `api_inline.txt`를 산출합니다. SPA forms가 대략 0이면 Phase 1로 전환합니다.

---

## Phase 1 — 정적

[스크립트와 Gate](#스크립트와-gate) · [도구와 출력 제약](#도구와-출력-제약)을 준수합니다.

```bash
python3 recon/harvest_static.py <BASE_URL> <OUTDIR>
```

harvest는 HTML script → webpack/Vite manifest를 분석하고 → 모든 lazy chunk를 다운로드하여 → `js/`, `api_static.txt`, `routes.txt`, `chunkmap.txt`를 산출합니다.

```bash
wc -l OUTDIR/api_static.txt OUTDIR/routes.txt
ls OUTDIR/js | wc -l
```

- manifest의 chunk 수와 비교합니다. 404면 harvest를 수정해 재시도하며 chunk별 수동 curl은 금지합니다.
- `api_static.txt`가 너무 적으면 OUTDIR 안 endpoint 정규식을 넓혀 재실행합니다(reference 참조).

### Phase 1b — 매개변수 역공학

path는 Phase 1에서 얻으며 매개변수 필드는 별도 recon합니다. grep 규칙은 [도구와 출력 제약](#도구와-출력-제약)을 참조합니다.

**완료 기준**: 중요 인터페이스에 대해 필드명, 전송 위치, 타입 추정, 필수 여부, 샘플 값, 신뢰도를 답할 수 있어야 합니다.

#### 1b.0 — 전송 형태

| 형태 | 매개변수 위치 | 정적으로 먼저 볼 것 |
|---|---|---|
| REST JSON | body + query | path 앵커 옆 `(params\|data\|body)\s*:\s*\{` |
| GraphQL | `variables` | gql 템플릿, `$page: Int` |
| 전통 form | urlencoded | `<form>`, `FormData` |
| 파일 업로드 | multipart | `FormData.append` |
| 경로 매개변수 | `/user/:id` | 라우트 표 + `useParams` / `$route.params` |
| 암호화/서명 | `sign`/`data`에 포장 | Hook 암호화 함수 입력(reference D절) |

인터페이스마다 `transport: query|json|form|graphql|encrypted`를 표시합니다.

#### 1b.1 — 앵커 확장

알려진 path를 앵커로 삼아 요청 조립 객체를 찾습니다.

```bash
grep -n '"/api/user/list"' OUTDIR/js/*.js | head -20
grep -rhoaE '.{0,120}("/api[^"]+").{0,200}' OUTDIR/js/*.js | head -20
grep -rhoaE '(params|data|body|payload)\s*:\s*\{' OUTDIR/js/*.js | head -20
```

| 래퍼 계층 | 매개변수 단서 |
|---|---|
| axios 인스턴스 | `data` / `params` |
| 통합 request | interceptor가 전역 필드 주입 |
| OpenAPI 클라이언트 | 생성 method 시그니처 |
| React Query / SWR | hook 두 번째 인자 |
| Vue composable | composable 인자 |

타입 잔재: `yup`/`zod`/rules, `Form.Item name=`, 내장 Swagger.

→ `param_candidates.json`: `{ path, fields[], source: "static-callsite", confidence }`

#### 1b.2 — 바인딩 계층

```
Form field → onFinish/handleSubmit → transform → API payload
```

| 바인딩 출처 | 방법 |
|---|---|
| 폼 submit | submit → transform → API를 따라감 |
| 테이블 검색 | `getFieldsValue()` → `params` |
| 라우트 | `:id` / `?tab=` |
| interceptor | 전역 `tenantId`, 페이지네이션, sign |
| enum select | `options` → API enum 값 |

DevTools call stack에서 `fetch`/`XHR.send`를 거슬러 올라가 조립 함수를 추적합니다.

#### 1b.3 — 요청 조립 세 질문(Phase 2 인증 세 게이트와 다름)

| 질문 | 답할 내용 |
|---|---|
| **조립** | payload를 어디서 build하는가, transform 흔적 |
| **검증** | required, pattern, enum |
| **전송** | path / query / body / multipart / header |

interceptor 게이트(Phase 2)를 읽을 때 전역 주입 필드(Authorization, `X-Tenant-Id`, sign)도 함께 읽습니다.

#### 1b.4 — Phase 3와 연결

후보 필드는 정적/바인딩 계층에서 옵니다. **필수/선택/조건 의존**은 Phase 3 매개변수 매트릭스 + diff + Phase 5 오류 역추론으로 확인해야 합니다.

---

## Phase 2 — 인증 세 게이트

`OUTDIR/js/`에서 `head`와 함께 grep하고 `config.json`에 기록합니다(reference 레시피 참조).

| 게이트 | 질문 | 키워드 |
|---|---|---|
| **렌더링 게이트** | 로그인 상태를 어떻게 판단하는가? | `isLogin`, `getToken`, Cookie/localStorage |
| **interceptor 게이트** | 무엇이 `/login`으로 이동하게 하는가? | `response_code`, `errno`, axios interceptor |
| **콘텐츠 게이트** | 메뉴/권한은 어디서 오는가? | `menu`, `permission`, `role`, `acl`, `routes` |

localStorage 키 이름만으로 자격 증명이라 하지 말고 chunk/요청 체인으로 확인합니다.

**출구 = Gate B**: 결론을 `config.json`에 쓰고 `OUTDIR/runtime_harvest.js` / `preload.js`를 수정합니다.

### Phase 2b — API 관찰(선택)

OUTDIR의 `preload.js`로 세션 키 이름, Authorization, 중첩 API URL을 확인합니다.

| 설정 | 산출 |
|---|---|
| `recordDetail: true` | `__API_RECON_DETAIL__` |
| `observe.xhrHeaders: true` | header 관찰 |
| `extractUrlsFromResponse: true` | 응답 내 child API |
| `observe.storageReads/cookieReads: true` | config에 반영할 세션 값 |
| `neutralizeVueRouter: true` | `__API_RECON_ROUTES__` |

coverage 매 라운드 `__API_RECON_LOG__`, `__API_RECON_DETAIL__`, `__API_RECON_ROUTES__`, `__API_RECON_OBSERVE__`를 내보냅니다.

---

## Phase 3 — 런타임

Gate B를 통과하고 [범위와 금지](#범위와-금지agent-필독--위반-시-범위-초과) 및 자격 증명 없는 mock 전략을 준수해야 합니다.

`config.json`에 `"runtimeMode": "depth" | "coverage" | "both"`를 설정합니다(reference 템플릿 참조).

### Hook과 stub(depth + coverage 공통)

| 계층 | 범위 | 목적 |
|---|---|---|
| L1 정확 | auth/권한/bootstrap stub | 첫 화면 인증 통과 |
| L2 부정 응답 보정 | 모든 JSON 응답 | 미로그인 코드 → 성공 |
| L3 fallback | L1 미매칭 `/api` 등 | 빈 성공 body로 UI 확장 |

- **depth**: fake auth + `forward`로 업무 코드 수정 + `stubs`; `routes`(hash/history)를 순회해 `runtime_api.json` 생성
- **coverage**: **document-start**에 `preload.js` 주입(CDP `addScriptToEvaluateOnNewDocument` 또는 Userscript)

확인: `window.__API_RECON_PRELOAD__`가 있고 업무 path가 `/login`으로 되돌아가지 않아야 합니다.

```bash
cd recon && npm install
node runtime_harvest.js config.json
```

### 3b — coverage 동적 열거(필수)

1. 주 navigation/sidebar — 각 항목을 클릭하고 네트워크를 1–3초 대기
2. Tab — `role=tab`, `.ant-tabs-tab`
3. 테이블 — 첫 행의 보기/편집/상세
4. 툴바 — 내보내기, 필터, 생성(**되돌릴 수 없는 삭제는 피함**)
5. 모듈 진입마다 — API/라우트 병합
6. SPA — `routes.txt`에 없는 path를 제한적으로 `pushState`(MPA 금지)

**매개변수 트리거 매트릭스**(필수): 모듈마다 작업 유형별로 한 번 기록하고 **다중 샘플을 diff**합니다.

| 작업 | 보통 추가되는 매개변수 |
|---|---|
| 목록 첫 화면 | 페이지네이션 + 기본 필터 |
| 검색 | keyword, filter |
| 고급 필터 | 추가 optional 필드 |
| 생성/수정 | 완전한 entity |
| 일괄/내보내기/정렬 | `ids[]`, `exportType`, `sortField` |

stub을 사용해도 outbound body/header는 실제이므로 요청을 기준으로 합니다. `scan_raw.json`, `param_samples.json`, `api_detail.json`에 기록합니다.

- **Vue**: `neutralizeVueRouter: true` + document-start preload
- **React**: `routes.txt` + 사이드바 클릭 + `pushState`
- **both**: 먼저 3a depth, 다음 3b coverage

---

## Phase 4 — 권한 트리 복원

**발동 조건**: 모듈 페이지가 비었거나 각 route가 bootstrap/locale만 반환 → 콘텐츠 게이트가 통과되지 않음.

| 현상 | 의미 |
|---|---|
| 셸 진입 성공 | 렌더링 게이트 + interceptor 게이트 통과 |
| 사이드바 항목 누락/클릭 시 빈 화면 | stub shape 또는 권한 코드 부족 |
| 각 route의 API가 같고 매우 적음 | `v-if permission` 불통과 |
| `routes.txt`가 bundle보다 훨씬 적음 | auth 모듈에서 보완 필요 |

```bash
grep -rhoaE '"/api[^"]*(permission|perm|role|menu|acl)[^"]*"' OUTDIR/js/*.js | sort -u | head -30
grep -rhoaE 'userRouteAuth|getResultTree|routeMap|routeLink|menuList|authList' OUTDIR/js/*.js | head -20
```

일반 체인: `role_permissions`(flat code) + `permissions/all`(tree) → `getResultTree` → `userRouteAuth[CODE].url`.

```bash
python3 recon/extract_route_map.py recon/js recon/
python3 recon/build_perm_tree.py recon/js recon/ --config recon/config.json
```

중간 산출물은 `route_map.json`, `userRouteAuth.json`, `permissions_tree.json`, `*_stub.json`, `perm_codes_all.txt`입니다. stub의 외부 `response_code`가 interceptor 게이트와 일치하는지, flat/tree가 맞는지, `routes`가 `route_map`의 모든 link를 포함하는지 확인합니다.

`config.json`을 갱신한 뒤 **Phase 3를 다시 실행**합니다. 대형 SPA는 `waitUntil`, `routeTimeout`, `perRouteMs`를 조정합니다(reference A3/I절).

---

## Phase 5 — 병합과 보고서

### 산출물 표

| 파일 | 단계 | 내용 |
|---|---|---|
| `js/`, `api_static.txt`, `routes.txt`, `chunkmap.txt` | 1 | 정적 bundle과 path |
| `param_candidates.json` | 1b | 정적 매개변수 필드 후보 |
| `config.json` | 2 | 3개 게이트 + runtime 설정 |
| `runtime_api.json` | 3a | depth 상세 기록(WS/SSE 포함) |
| `param_samples.json`, `scan_raw.json`, `api_detail.json` | 3b | 다중 샘플, 클릭 로그, detail |
| `route_map.json` 등 | 4 | 권한 트리 중간 파일(실행 시) |
| `params_merged.json` | 5 | 병합 필드 + 신뢰도 |
| `api_merged.txt` | 5 | `METHOD /path [params] [static\|runtime\|both]` |
| `site_map.json` | 5 | 라우트·API·params·기능·한계 |
| **insert_assets** | 5 | 모든 서비스·endpoint 자산을 자산 저장소에 기록 |

### 5b — 매개변수 병합

`param_samples.json`을 diff합니다(**범용 병합 스크립트 없음**). 신뢰도 규칙은 reference J7(높음/중간/낮음/트리거 대기)을 참조합니다.

### 5c — 오류 역추론

승인 범위에서 불완전한 요청으로 400( **매개변수 recon이며 취약점 테스트가 아님** )을 읽을 수 있습니다: `field 'x' is required`, enum 오류 등. data wrapper, variables, 암호화 전 bizData에 주의합니다.

보고서에는 runtimeMode, 정적/런타임 API 수, 매개변수 신뢰도, 미커버 모듈, 참고 스크립트 대비 `CHANGES.md` 요약을 적습니다.

`site_map.json` 권장 구조:

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

추가 필드와 grep 레시피는 [reference.ko.md](reference.ko.md)를 참조합니다.

---

## 일반 설명

- **프레임워크 무관**: webpack/Vite/Angular lazy load에 같은 방법 적용
- **전송**: REST/JSON, GraphQL, WebSocket, SSE; gRPC-web은 범위 밖
- **SSR**: 클라이언트 fetch는 기록할 수 있지만 RSC/Server Actions는 완전 열거 불가
- **사각지대**: JSVMP, WASM, HMAC/mTLS 강제 검증 → 정적 분석 + 한계 표시
- **매개변수 사각지대**: 조건부 연동, hidden parameter, WASM 조립 → 「트리거 대기」/「도달 불가」
- **정적 분석은 안전망**: runtime이 막혀도 정적으로 endpoint 열거

---

## 추가 자료

- grep 레시피, `config.json` 템플릿, 장애 해결, Hook, 매개변수 역공학 J절, site_map 템플릿: **[reference.ko.md](reference.ko.md)**
- 참고 스크립트 경로는 [스크립트와 Gate](#스크립트와-gate) 표를 참조합니다.

