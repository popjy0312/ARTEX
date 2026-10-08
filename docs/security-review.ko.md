# ARTEX 보안 및 백도어 검토

[English](security-review.en.md) | [한국어](security-review.ko.md)

**검토 기준:** ARTEX `v0.3.15`, commit `e6ec569`, 2026-10-08 검토.

## 결론

체크인된 소스에서 의도적인 백도어, 숨은 telemetry, command-and-control endpoint, 은밀한 persistence, 내장 악성 실행 파일, hard-coded 운영 secret 또는 credential 탈취 루틴의 직접 증거는 발견하지 못했습니다.

이는 ARTEX가 안전하다는 증명이 아닙니다. ARTEX는 의도적으로 shell command와 Python을 실행하고, stdio MCP process를 시작하며, 임의의 대상 네트워크 요청을 만들고, 복호화된 트래픽을 캡처하고, credential을 저장하며, 자체 실행 파일을 교체할 수 있습니다. 따라서 관리자 계정, 모델, prompt, skill, dependency, release 계정 또는 container image가 침해되면 백도어와 동등한 피해가 발생할 수 있습니다.

**현재 도입 판정: 아직 production control plane에 배포하지 마십시오.** 아래 승인 gate를 충족할 때까지 격리된 평가 환경에서만 사용해야 합니다.

## 이 브랜치에 적용한 개선

- Docker 자동 설치의 `curl | sh`를 제거하고 installer에 제한적인 `umask`를 적용했습니다.
- Image pull을 fail-closed로 바꾸고, 알려진 기본 DB password를 제거하고, Docker mode secret 문법을 제한하고, local DB port/TLS mode를 검증하고, local DB 설정을 JSON escape했습니다.
- Dockerfile의 원격 NodeSource installer를 digest로 고정한 공식 Node image로 교체하고 Playwright package 버전을 정확히 고정했습니다.
- PostgreSQL image digest를 고정하고 기본 ARTEX image tag를 `latest`에서 `v0.3.15`로 바꾸고 management port를 기본적으로 `127.0.0.1`에만 bind했습니다.
- 전용 `/app/state` mount와 `-key-dir` option을 추가해 Docker container 교체 시 JWT key가 회전하거나 탐색 가능한 workspace에 노출되지 않게 했습니다.
- Query-string JWT 인증을 EventSource 호환성이 필요한 GET SSE route 네 개로 제한했습니다.
- Workspace 연산을 Go의 descriptor-relative `os.Root` API로 옮기고 명시적 symlink 거부를 유지했으며 read, download, write, mkdir, delete 탈출 regression test를 추가했습니다. 기존 check/use race를 제거했습니다.
- Frontend lockfile을 갱신하고 `shadcn` build CLI를 development dependency로 이동했습니다. Production dependency audit은 0건이며 전체 development audit에는 breaking upstream 변경이 필요한 `shadcn` toolchain high finding 7건이 남습니다.
- Go 1.26으로 `govulncheck`를 실행해 도달 가능한 취약점 0건을 확인했습니다. Required module에는 advisory 4건이 있지만 이 코드 snapshot은 취약 symbol을 호출하지 않습니다.

## 우선순위 finding과 현재 상태

근거 열은 업스트림 `v0.3.15` snapshot에서 발견한 상태이고, 브랜치 상태 열은 이 hardening branch의 현재 결과입니다.

| 심각도 | Finding | 업스트림 근거 | 브랜치 상태 | 보안 영향 |
| --- | --- | --- | --- | --- |
| High | 원격 설치 script를 내용 검증 없이 실행 | `install.sh`가 `get.docker.com`을 `sh`로 pipe하고 Dockerfile이 NodeSource setup script 실행 | **수정 완료** | 업스트림 또는 전달 경로 침해 시 설치/build 과정에서 코드 실행 가능 |
| High | 자율 agent가 영속 실행 도구 생성 가능 | `server/orchestration.go`, `server/platform_tools.go`, `server/customtool.go` | **미해결** | prompt injection 또는 침해된 모델이 shell/Python/MCP 실행을 영속화하고 service secret 상속 가능 |
| High | 공급망 입력이 변경 가능 | Docker/application tag, action tag, apt input, browser artifact, 미서명 release metadata | **부분 수정**; base/PostgreSQL image와 Playwright version은 고정했지만 application tag, apt repository, browser artifact, action, release provenance는 추가 강화 필요 | 동일 commit을 다시 build해도 다른 코드가 실행될 수 있음 |
| High | Frontend dependency audit에서 알려진 취약점 확인 | 원본 lockfile의 production finding 24건 | **Production 수정 완료**; production audit 0건, development toolchain high 7건 유지 | 실제 노출은 package reachability와 build 격리에 따라 달라짐 |
| Medium | JWT를 query string으로 받고 script-readable browser storage에 저장 | `server/auth.go`, `web/src/lib/api.ts`, `web/src/lib/auth.ts` | **부분 수정**; query token은 필요한 SSE GET route로 제한했지만 URL/localStorage 노출은 남음 | history, log, referrer 또는 XSS를 통한 token 유출 가능 |
| Medium | Workspace 제한이 문자열 기반이며 symlink에 안전하지 않음 | 원본 `server/workspace.go`가 path 검사 후 일반 filesystem call 사용 | **수정 완료**; descriptor-relative `os.Root`와 regression test 적용 | workspace symlink가 인증된 파일 연산을 workspace 밖으로 전환 가능 |
| Medium | 기본 container 권한과 노출 범위가 큼 | Dockerfile에 non-root `USER` 없음; Compose가 writable host directory mount | **부분 수정**; UI bind는 loopback 기본값이나 root 실행과 writable mount는 남음 | 서비스 침해 시 host/network 피해 범위 확대 |
| Low/Medium | 로컬 설치 중 DB credential 노출 또는 설정 손상 가능 | 원본 installer의 permissive output과 raw string interpolation | **수정 완료**; `umask 077`, 입력 검증/escape, 알려진 기본 password 제거, fail-closed pull 적용 | 다른 로컬 사용자 또는 malformed 값이 credential/configuration에 영향 가능 |

## 공급망 관찰 결과

- 체크아웃된 `v0.3.15` tag와 commit에는 Git 서명이 없습니다.
- Self-update는 GitHub domain으로 다운로드 대상을 제한하고 SHA-256을 검증하므로 전송 오류 방어에는 유용합니다. 하지만 checksum과 binary가 같은 release trust domain에서 오므로 maintainer/release 계정 침해는 방어하지 못합니다.
- `skills/api-recon/scripts/package-lock.json`은 `registry.npmmirror.com` URL을 사용합니다. Integrity hash가 위험을 줄이지만 내부 build에서는 승인된 registry mirror와 provenance policy가 필요합니다.
- 저장소에 추적된 ELF, PE, Mach-O 실행 파일과 활성 Git hook은 없었습니다. 확인된 큰 binary는 image asset뿐입니다.
- Secret pattern과 bidirectional-Unicode scan에서 실제 내장 credential이나 소스 난독화 marker는 발견되지 않았으며 일치 항목은 test fixture였습니다.

## 확인된 긍정적 통제

- 대부분의 API route가 JWT middleware로 보호됩니다.
- 최초 관리자 생성은 DB uniqueness와 race handling으로 보호됩니다.
- 알림 전송에 SSRF와 cross-host redirect 방어가 있고 credential 포함 URL을 redaction합니다.
- Skill archive 추출에 path, entry 수, 크기 제한이 적용됩니다.
- Self-update는 허용 host 제한, HTTPS, hash 검증, 후보 smoke test, rollback을 제공합니다.
- 인증, intercept decision, notification security, task concurrency, update 동작을 다루는 behavior/regression test가 폭넓게 존재합니다.

## 내부 운영 도입 전 필수 gate

- [ ] 전용 disposable VM 또는 hardened container host에서 build/run합니다.
- [ ] Container base image, npm package, GitHub Actions, release artifact를 immutable digest 또는 commit으로 고정합니다.
- [x] 승인된 배포 경로에서 `curl | sh` 설치/build 방식을 제거합니다.
- [x] Descriptor-relative `os.Root` workspace 연산을 사용하고 symlink component와 leaf symlink를 거부하며 regression test를 추가합니다.
- [x] Query-string 인증을 필요한 최소 SSE endpoint로 제한했습니다. URL token 자체를 제거하는 방식이 여전히 더 좋습니다.
- [ ] 명시적인 사람 승인 없이 자율적으로 실행 도구를 생성하지 못하게 합니다.
- [ ] 명시적 환경변수 allowlist와 egress policy가 있는 sandbox에서 tool process를 실행합니다.
- [x] 감사된 frontend dependency를 업그레이드해 production dependency audit을 0건으로 만들었습니다. Development-only `shadcn` toolchain finding 7건은 문서화해 유지합니다.
- [ ] Non-root 실행, capability 제거, read-only root filesystem, 제한된 writable volume, 명시적 network binding을 적용합니다.
- [ ] 앱 내 self-update를 비활성화하고 서명·검토된 build만 내부 registry로 승격합니다.
- [ ] 전용 secret manager를 사용하고 평가 credential은 운영 전 모두 rotate합니다.
- [ ] 대표 task에서 정상 runtime egress baseline을 수집하고 새로운 destination을 탐지합니다.

## 검토 한계

이번 검토는 체크인된 source, script, dependency manifest, Git metadata, executable file, outbound endpoint, 일부 보안 민감 control path, npm advisory, 도달 가능한 Go 취약점을 검사했습니다. Dependency source integrity 입증, 공개 Docker image/release binary 검사, 동적 sandbox/egress test, 외부 `norma` dependency 전수 감사는 수행하지 못했습니다. 강한 백도어 부재 결론을 내리기 전에 반드시 후속 검증해야 합니다.

구성 요소와 trust boundary는 [아키텍처](architecture.ko.md)를 참고하십시오.
