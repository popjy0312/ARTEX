---

## name: scopesentry-mcp
description: ScopeSentry MCP를 통해 보안 스캔 플랫폼(프로젝트, 작업, 템플릿, 자산, 노드)을 관리할 때 사용하는 스킬입니다. 사용자가 ScopeSentry, MCP, API 키, 스캔 작업 또는 자산 조회를 언급하면 사용합니다.

# ScopeSentry MCP 사용 안내

**배포된 ScopeSentry 인스턴스**를 사용하는 사용자를 위한 안내입니다. Cursor(또는 다른 MCP 클라이언트)를 통해 플랫폼에 연결하며 로컬 소스 코드는 필요하지 않습니다.

## 1. 준비

### 1.1 서비스 접근 확인

- 기본 Web 인터페이스: `http://<호스트>`
- MCP 엔드포인트: `http://<호스트>/mcp` (역방향 프록시 또는 프런트엔드 프록시가 앞에 있으면 실제 `/mcp` 주소 사용)

### 1.2 API Key 생성

1. 브라우저에서 ScopeSentry Web 인터페이스에 로그인합니다.
2. **API Key** 관리 페이지에서 키를 생성하거나(또는 관리자가 제공한 생성 엔드포인트를 사용합니다).
3. 반환된 `ssk_...` 문자열을 저장합니다(**한 번만 표시됩니다**).

### 1.3 Cursor MCP 설정

Cursor → Settings → MCP → 서버 추가:

```json
{
  "mcpServers": {
    "scopesentry": {
      "url": "http://<호스트>:8082/mcp",
      "headers": {
        "X-API-Key": "ssk_내_API_키"
      }
    }
  }
}
```

다음도 사용할 수 있습니다: `Authorization: Bearer ssk_내_API_키`

설정이 끝나면 MCP를 재시작하거나 Cursor를 다시 로드하고, 도구 목록에 `list_projects`, `list_assets` 등이 표시되는지 확인합니다.

---

## 2. 도구 한눈에 보기


| 도구                     | 용도                |
| ---------------------- | ----------------- |
| `list_projects`        | 태그별 프로젝트 트리(프로젝트 ID 포함) |
| `list_projects_data`   | 이름으로 검색할 수 있는 페이지 단위 프로젝트 목록     |
| `get_project`          | 프로젝트 상세              |
| `create_project`       | 프로젝트 생성              |
| `list_tasks`           | 스캔 작업 목록            |
| `get_task`             | 작업 상세              |
| `list_scan_templates`  | 스캔 템플릿 목록            |
| `get_scan_template`    | 템플릿 상세              |
| `list_plugin_modules`  | 스캔 파이프라인 모듈명          |
| `list_plugins`         | 사용 가능한 플러그인(hash 및 기본 매개변수 포함) |
| `create_scan_template` | 스캔 템플릿 생성            |
| `create_scan_task`     | 스캔 작업 생성            |
| `list_assets`          | 여러 유형의 자산 조회(페이지 단위 목록)       |
| `count_assets`         | 자산 개수(`/api/assets/common/total`) |
| `get_asset_detail`     | 자산 또는 취약점 상세           |
| `add_asset_tag`        | 자산에 태그 추가           |
| `list_nodes`           | 스캔 노드 목록            |


도구 매개변수는 MCP 도구 설명(schema)을 기준으로 합니다. `list_assets`와 `count_assets`는 동일한 search 및 filter 문법을 사용하므로, 자산을 조회하기 전에 `list_assets` description을 읽을 수 있습니다.

전체 항목 수가 필요하면 개수를 세기 위해 `list_assets`를 반복해서 페이징하지 말고 `count_assets`(Web 페이지의 전체 개수 엔드포인트)를 사용합니다.

---

## 3. 주요 작업 흐름

### 3.1 프로젝트별 자산 조회

사용자 또는 컨텍스트에 **이미 프로젝트 조건이 있는 경우** `filter.project`를 전달하여 범위를 좁히고 프로젝트 간 데이터가 너무 많이 응답되지 않도록 합니다. 프로젝트가 명확하지 않으면 프로젝트 필터 추가는 필수가 아닙니다.

1. `list_projects` 또는 `list_projects_data`로 대상 프로젝트의 **ObjectID**(`id` / `children[].value`)를 가져옵니다.
2. `list_assets`에 `filter.project`를 전달합니다(**ID여야 하며 화면에 표시되는 프로젝트 이름을 사용하면 안 됩니다**).

```json
{
  "asset_type": "asset",
  "pageIndex": 1,
  "pageSize": 20,
  "search": "domain=^example.com",
  "filter": {
    "project": ["<프로젝트ObjectID>"]
  }
}
```

### 3.2 스캔 작업 생성

1. `list_nodes`로 온라인 노드 이름을 가져옵니다.
2. `list_scan_templates` 또는 `create_scan_template`으로 템플릿 **ObjectID**를 가져옵니다.
3. `create_scan_task`에서 `name`과 `node`는 필수이며, `template`에는 템플릿 이름이 아니라 템플릿 ID를 넣습니다.

**대상 소스 `targetSource`(Web 클라이언트와 동일):**

| targetSource | 의미 | 필수 매개변수 |
| --- | --- | --- |
| `general` | 대상을 직접 입력 | `target` |
| `project` | 프로젝트에서 대상 읽기 | `project`(프로젝트 ObjectID 배열) |
| `asset` | Web 자산 저장소 검색 | `search`; `project`, `filter`, `targetNumber` 선택 사항 |
| `RootDomain` | 루트 도메인 저장소 검색 | `search`; `project`, `filter`, `targetNumber` 선택 사항 |
| `subdomain` | 서브도메인 저장소 검색 | `search`; `project`, `filter`, `targetNumber` 선택 사항 |
| `UrlScan` | URL 스캔 결과 검색 | `search`; `project`, `filter`, `targetNumber` 선택 사항 |
| `*Source`(예: `subdomainSource`) | 자산 페이지에서 “선택/검색”한 자산으로 생성 | `targetTp=search`일 때 `search`; `targetTp=select`일 때 `targetIds` 사용 |

**예시 — 루트 도메인을 직접 스캔:**

```json
{
  "name": "example-서브도메인-수집",
  "node": ["node-1"],
  "template": "<템플릿ObjectID>",
  "targetSource": "general",
  "target": "example.com\nfoo.com",
  "project": ["<프로젝트ObjectID>"]
}
```

**예시 — 서브도메인 저장소에서 이어서 스캔(이전 작업명으로 필터링):**

```json
{
  "name": "example-포트-및-취약점",
  "node": ["node-1"],
  "template": "<후속-모듈-템플릿-ObjectID>",
  "targetSource": "subdomain",
  "search": "task==\"example-서브도메인-수집\"",
  "project": ["<프로젝트ObjectID>"]
}
```

### 3.3 루트 도메인 전체 정보 수집(권장 2단계)

입력이 **루트 도메인**이고 **전체 정보 수집**이 필요하면 전체 파이프라인을 한 번에 실행하지 말고 두 번의 스캔으로 나눕니다.

**이유:** 분산 작업은 **개별 대상** 단위로 배포됩니다. 루트 도메인이 한 노드에 배정되면 해당 노드에서 발견된 서브도메인도 그 노드에서 후속 모듈을 계속 실행하므로 부하 불균형, 느린 실행, 오류가 발생할 수 있습니다.

**권장 방법:**

1. **1단계 — 서브도메인 수집만 수행**
   - `targetSource`: `general`
   - `target`: 모든 루트 도메인(한 줄에 하나)
   - 템플릿: `SubdomainScan` 및 `SubdomainSecurity`만 활성화(서브도메인 스캔 + 서브도메인 탈취)
   - `get_task`를 사용하여 작업이 완료될 때까지 기다립니다.

2. **2단계 — 후속 모듈 실행**
   - `targetSource`: `subdomain`
   - `search`: `task=="<1단계 작업 이름>"`(작업명 정확히 일치)
   - 필요하면 `project`로 범위를 좁힙니다.
   - 템플릿: 포트 스캔, 자산 매핑, 취약점 스캔 등( `SubdomainScan`을 포함하지 않아도 됨)
   - 서브도메인이 독립 대상으로 노드에 배포되므로 병렬 실행 효율이 높아집니다.

Web “서브도메인” 자산 페이지에서 작업명으로 필터링한 뒤 “서브도메인에서 작업 생성”을 사용할 수도 있으며 결과는 같습니다.

```mermaid
flowchart LR
  A[루트 도메인 목록] --> B[1단계: general + SubdomainScan]
  B --> C[서브도메인 저장]
  C --> D[2단계: subdomain + task==1단계-작업명]
  D --> E[포트/자산/취약점 모듈]
```

### 3.4 스캔 템플릿 생성

1. `list_plugin_modules` → 모듈명 목록
2. `list_plugins`(`module`로 선택적으로 필터링) → 각 플러그인의 `hash` 및 기본 `parameter`
3. `create_scan_template`: `modules`를 사용하여 “모듈 → 플러그인 hash 배열” 매핑을 지정합니다.

---

## 4. 자산 조회(`list_assets` / `count_assets`)

`count_assets`와 `list_assets`는 동일한 `asset_type`, `search`, `filter`를 사용하며 `{ "total": N }`을 반환합니다. 이는 Web 엔드포인트 `/api/assets/common/total`에 해당합니다.

```json
{
  "asset_type": "subdomain",
  "search": "task==\"특정-작업명\"",
  "filter": {"project": ["<프로젝트ObjectID>"]}
}
```

**성능 권장 사항(`list_assets` / `count_assets` 공통):** 프로젝트 조건이 있으면 `filter.project`로 범위를 좁히는 것이 좋습니다. `search`의 인덱스 필드는 `==` 완전 일치 또는 `^` 접두사 매칭을 우선 사용하고([4.3](#43-search-검색-표현식) 참조), 응답을 느리게 하는 넓은 범위의 `=` 퍼지 검색은 피합니다. 프로젝트 컨텍스트가 없으면 프로젝트 필터 추가는 필수가 아닙니다.

`filter.project`를 지원하는 유형은 [4.4](#44-filter-정확한-필터) 표를 참조합니다.

### 4.1 자산 유형 `asset_type`

`asset`, `RootDomain`, `subdomain`, `app`, `mp`, `UrlScan`, `SensitiveResult`, `DirScanResult`, `crawler`, `vulnerability`, `PageMonitoring`, `IPAsset`, `SubdomainTakerResult`

별칭 예시: `web`→asset, `vuln`→vulnerability, `ip`→IPAsset, `url`→UrlScan

### 4.2 매개변수 설명


| 매개변수                       | 설명                                      |
| ------------------------ | --------------------------------------- |
| `pageIndex` / `pageSize` | 페이지 매김, 기본값 1 / 20                            |
| `search`                 | 검색 표현식(다음 절 참조)                              |
| `filter`                 | 정확한 필터 JSON(다음 절 참조)                          |
| `sort`                   | UrlScan, DirScanResult만 `length` 정렬 지원 |
| `sid`                    | SensitiveResult 전용: 민감 규칙 이름                |


`search`와 `filter`는 **함께 사용할 수 있습니다**.

### 4.3 search 검색 표현식

사용자 정의 DSL(**SQL이 아님**):


| 연산자  | 의미   | 인덱스 | 예시                          |
| ---- | ---- | ---- | --------------------------- |
| `=`  | 퍼지 일치(regex) | 사용하지 않음 | `domain=example`            |
| `==` | 정확히 일치 | **사용** | `port==443`                 |
| `!=` | 제외   | — | `port!="80"`                |
| `&&` | AND    | — | `domain==example.com && port==443` |
| `||` | OR    | — | `title=admin || body=login` |


**인덱스와 연산자:** `domain`, `ip`, `port`, `title` 등의 필드는 인덱싱되어 있지만 **`==` 완전 일치** 또는 **값이 `^`로 시작하는 접두사 매칭**(예: `domain=^example.com`)에서만 인덱스를 사용합니다. **`=`는 퍼지 regex 일치로 변환되어 인덱스를 사용할 수 없으므로** 데이터가 많으면 느려질 수 있습니다.

**모든 유형에 공통인 search 필드:** `tag`, `task`(작업명), `rootDomain`

**`project`를 `search`에 넣지 마세요**(유효하지 않거나 `&&`와 조합할 때 오류가 발생합니다). 프로젝트 필터에는 `filter.project`를 사용합니다.

**유형별 일반 search 필드:**


| asset_type           | 필드                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------- |
| asset                | domain, ip, port, service, app, title, statuscode, icon, banner, type, body, header |
| RootDomain           | domain, icp, company                                                                |
| subdomain            | domain, ip, type, value                                                             |
| app                  | name, icp, company, category, description, url, apk                                 |
| mp                   | name, icp, company, category, description, url                                      |
| UrlScan              | url, input, source, resultId, type                                                  |
| SensitiveResult      | url, sname, body, info, md5                                                         |
| DirScanResult        | url, statuscode, redirect, length                                                   |
| vulnerability        | url, vulname, matched, request, response, level                                     |
| crawler              | url, method, body, resultId                                                         |
| PageMonitoring       | url, hash, diff, response                                                           |
| IPAsset              | ip, domain, port, service, webServer, app                                           |
| SubdomainTakerResult | domain, value, type, response                                                       |


**search 예시:**

- `domain==www.example.com && port==443`(정확히 일치하며 인덱스를 사용)
- `domain=^example.com`(접두사 매칭이며 인덱스를 사용)
- `ip==192.168.1.1`
- `task=="특정-작업명"`
- `level==high`(vulnerability)
- `statuscode==200`(DirScanResult)

퍼지 포함 검색이 필요할 때만 `=`를 사용합니다. 예를 들어 `title=admin`(인덱스를 사용하지 않으므로 프로젝트 등의 조건과 함께 범위를 좁히는 것이 좋습니다)입니다.

### 4.4 filter 정확한 필터

JSON 객체: 동일한 key의 여러 값은 **OR**, 서로 다른 key는 **AND**입니다.

**프로젝트 조건이 있으면 `project`를 우선 사용:** 사용자 또는 컨텍스트에 프로젝트가 이미 지정되어 있고 `asset_type`이 `project`를 지원하면 범위를 좁히도록 포함합니다. 프로젝트 정보가 없으면 필수가 아닙니다.


| filter key   | 의미        | 값 설명                                                     |
| ------------ | -------- | -------------------------------------------------------- |
| `project`    | 소속 프로젝트     | **ObjectID**; `list_projects` / `list_projects_data`로 가져옴 |
| `task`       | 원본 작업     | **작업명**; `list_tasks`의 `name` 사용                         |
| `port`       | 포트       | 예: `"443"`                                                |
| `service`    | 서비스/프로토콜    | 예: `"https"`                                              |
| `app`        | 애플리케이션 지문     | 예: `"Nginx"`                                              |
| `icon`       | 아이콘 hash  |                                                          |
| `statuscode` | HTTP 상태 코드 | 주로 asset에 사용                                               |
| `status`     | 상태       | UrlScan/DirScan HTTP 코드, 취약점/민감 정보 처리 상태                       |
| `level`      | 취약점 등급     | critical / high / medium / low / info                    |
| `type`       | 유형       | 예: 서브도메인 레코드 유형 A, CNAME                                         |
| `color`      | 민감 규칙 색상   | SensitiveResult                                          |
| `sname`      | 민감 규칙 이름    | SensitiveResult                                          |
| `tags`       | 태그       |                                                          |


**유형별 사용 가능한 filter key:**


| asset_type                            | filter key                                                      |
| ------------------------------------- | --------------------------------------------------------------- |
| asset                                 | project, port, service, app, icon, statuscode, type, task, tags |
| RootDomain                            | project, tags                                                   |
| subdomain                             | project, type, task, tags                                       |
| app / mp                              | project, tags                                                   |
| UrlScan                               | status, tags                                                    |
| DirScanResult                         | status, tags                                                    |
| SensitiveResult                       | status, color, sname, tags                                      |
| crawler                               | project, task, tags                                             |
| vulnerability                         | project, level, status, task, tags                              |
| PageMonitoring / SubdomainTakerResult | tags                                                            |
| IPAsset                               | project, port, service, app                                     |


**filter 예시:**

```json
{"project": ["<프로젝트ObjectID>"], "port": ["443"]}
```

**조합 쿼리 예시:**

```json
{
  "asset_type": "asset",
  "search": "domain=^baidu && port==443",
  "filter": {"project": ["<프로젝트ObjectID>"]},
  "pageIndex": 1,
  "pageSize": 10
}
```

**주의:**

- 프로젝트 조건이 있으면 `filter.project`를 우선 사용합니다(지원되는 경우). 프로젝트 컨텍스트가 없으면 필수가 아닙니다.
- `filter.project`에 화면에 표시되는 프로젝트 이름을 입력하지 마세요.
- 알려진 값에는 `==`, 접두사에는 `^`를 사용하고, 큰 테이블에서 `=` 퍼지 검색을 과도하게 사용하지 마세요.
- UrlScan의 HTTP 상태에는 `filter.status`를 사용하고, DirScanResult는 `search`에서 `statuscode==200`을 사용할 수 있습니다.
- SensitiveResult를 규칙명으로 필터링할 때는 `search`에 `sname=규칙명`을 사용하거나 `filter.sname`을 사용합니다.

### 4.5 정렬 sort

**UrlScan** 및 **DirScanResult**만 지원합니다.

```json
{"length": "ascending"}
```

그 밖의 유형은 `sort`를 무시하고 기본 시간순으로 정렬합니다.

---

## 5. 스캔 템플릿 모듈명

`TargetHandler`, `SubdomainScan`, `SubdomainSecurity`, `PortScanPreparation`, `PortScan`, `PortFingerprint`, `AssetMapping`, `AssetHandle`, `URLScan`, `WebCrawler`, `URLSecurity`, `DirScan`, `VulnerabilityScan`, `PassiveScan`

---

## 6. 문제 해결


| 증상        | 조치                                                 |
| --------- | -------------------------------------------------- |
| MCP 도구가 없음   | URL, API Key 및 ScopeSentry 실행 여부 확인                    |
| 401 / 403 | API Key 재생성 또는 교체                                    |
| 자산을 찾을 수 없음     | `filter.project`가 ObjectID인지 확인하고 `search`에 `project`를 넣지 않음 |
| 템플릿/작업 생성 실패 | `template`은 템플릿 ObjectID여야 하고 `node`는 온라인 노드 이름이어야 함            |
| 조회가 느리거나 멈춤   | 프로젝트가 있으면 `filter.project` 추가, 인덱스 필드에는 `search`에서 `==` 또는 `^` 접두사 사용, `=` 사용 줄이기, `pageSize` 축소 |


---
