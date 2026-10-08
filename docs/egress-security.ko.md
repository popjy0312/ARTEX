# 외부 통신 보안 설정

ARTEX는 기본적으로 `.cn` 도메인과 코드에 알려진 중국 운영 서비스 도메인을 거부합니다. LLM, MCP HTTP/SSE, 알림 HTTP/SMTP, 사용자 정의 HTTP 도구, 자산 HTTP/DNS 보강, 모델 목록 조회, 기록 프록시의 목적지와 상위 프록시에 같은 정책을 적용합니다.

조직에서 추가로 차단할 주소는 Compose의 `.env`에 쉼표로 구분해 지정합니다.

```dotenv
ARTEX_EGRESS_DENY_HOSTS=example.cn,untrusted.example
ARTEX_EGRESS_DENY_CIDRS=203.0.113.0/24,2001:db8::/32
```

변경 후에는 운영자가 검토한 이미지 또는 바이너리로 수동 배포합니다. 애플리케이션의 자동 업데이트와 시작 시 MCP 자동 탐색은 제거되어 있습니다.

## MCP와 Skill 보안 경계

- 원격 MCP는 HTTPS만 허용합니다. 예외는 같은 컴퓨터의 `localhost`/loopback HTTP뿐입니다.
- MCP 리디렉션과 legacy SSE 전송 주소는 최초 설정 주소와 동일한 scheme/host/port여야 합니다. 인증 헤더를 다른 서버로 전달하지 않습니다.
- stdio MCP와 Agent 하위 프로세스를 시작하기 전에 API key, token, secret, password, proxy 및 클라우드 자격 증명 환경변수를 제거합니다.
- 서비스 시작만으로 MCP에 연결하거나 `npx` 프로세스를 실행하지 않습니다. 관리자가 명시적으로 탐색하거나 활성화한 Agent 세션에서만 연결합니다.
- `api-recon`, `playwright-cli`, `scopesentry`처럼 네트워크를 사용하는 내장 Skill은 기본 노출을 끄며, 이전 설치의 기본 노출도 한 번 비활성화합니다.
- Auto Agent는 Skill, 사용자 정의 실행 도구, MCP 설정을 생성하거나 변경할 수 없습니다. 이 작업은 인증된 관리자 API/UI에만 남아 있습니다.

## 보장 범위와 호스트 방화벽

이 정책은 애플리케이션이 인식하는 hostname과 운영자가 제공한 CIDR을 차단합니다. 그러나 Agent에 허용된 Bash, 브라우저, `nmap`, raw socket은 Go 애플리케이션 정책을 우회할 수 있습니다. 또한 외부 LLM을 사용하면 프롬프트와 도구 결과가 해당 LLM 사업자에게 전송됩니다.

따라서 중국 IP 대역까지 강제로 차단해야 하는 운영 환경은 다음을 함께 적용해야 합니다.

1. 배포 시점에 검증한 APNIC CN IPv4/IPv6 목록을 호스트 방화벽 또는 전용 egress gateway에 반영합니다.
2. 컨테이너의 직접 인터넷 출구를 막고, 허용 목적지를 검사하는 gateway만 사용합니다.
3. DNS를 승인한 resolver로만 제한하고 UDP/TCP 53 및 DoH 우회를 차단합니다.
4. 정보가 외부로 나가면 안 되는 작업은 로컬 LLM을 사용하고 작업별 목적지 allowlist를 별도 network namespace에서 강제합니다.

IP 국가 분류는 주소 할당 기준이므로 실제 장비 위치와 항상 같지는 않습니다. 외부 proxy/VPN이 중국으로 다시 중계하는 경우도 애플리케이션만으로 판별할 수 없습니다.
