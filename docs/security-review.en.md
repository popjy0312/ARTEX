# ARTEX Security and Backdoor Review

[English](security-review.en.md) | [한국어](security-review.ko.md)

**Snapshot:** ARTEX `v0.3.15`, commit `e6ec569`, reviewed 2026-10-08.

## Conclusion

No direct evidence of a deliberate backdoor, hidden telemetry, command-and-control endpoint, covert persistence, embedded malicious executable, hard-coded production secret, or credential-exfiltration routine was found in the checked-in source.

This is not proof that ARTEX is safe. ARTEX intentionally executes shell commands and Python, launches stdio MCP processes, makes arbitrary target-network requests, captures decrypted traffic, stores credentials, and can replace its own executable. A compromised administrator account, model, prompt, skill, dependency, release account, or container image can therefore produce backdoor-equivalent impact.

**Current adoption verdict: do not deploy on a production control plane yet.** Use only in an isolated evaluation environment until the acceptance gates below are met.

## Remediation applied on this branch

- Removed automatic `curl | sh` Docker installation and added a restrictive installer `umask`.
- Made image pulls fail closed, removed the known default database password, constrained Docker-mode secret syntax, validated local database ports/TLS modes, and JSON-escaped local database settings.
- Replaced the Dockerfile's remote NodeSource installer with a digest-pinned official Node image; pinned Playwright packages to exact versions.
- Pinned PostgreSQL image digests, changed the default ARTEX image tag from `latest` to `v0.3.15`, and bound the management port to `127.0.0.1` by default.
- Added a dedicated persisted `/app/state` mount and `-key-dir` option so Docker container replacement does not rotate the JWT key or expose it through the browsable workspace.
- Restricted query-string JWT authentication to the four GET SSE routes that require EventSource compatibility.
- Moved workspace operations to Go's descriptor-relative `os.Root` API, retained explicit symlink rejection, and added regression tests for read, download, write, mkdir, and delete escapes. This closes the prior check/use race.
- Refreshed the frontend lockfile and moved the `shadcn` build CLI to development dependencies. The production dependency audit now reports zero findings; the full development audit retains seven high findings in the `shadcn` toolchain and requires a breaking upstream change.
- Ran `govulncheck` with Go 1.26: zero reachable vulnerabilities were found. Four advisories exist in required modules, but no vulnerable symbols are called by this code snapshot.

## Ranked findings and current status

The evidence column records what was found in the upstream `v0.3.15` snapshot. The status column reflects this hardening branch.

| Severity | Finding | Upstream evidence | Branch status | Security impact |
| --- | --- | --- | --- | --- |
| High | Remote install scripts executed without content verification | `install.sh` piped `get.docker.com` to `sh`; the Dockerfile ran a NodeSource setup script | **Remediated** | Upstream or network-channel compromise could execute code during installation/build |
| High | Autonomous agents can create persistent executable tools | `server/orchestration.go`, `server/platform_tools.go`, `server/customtool.go` | **Open** | Prompt injection or a compromised model can persist shell/Python/MCP execution and inherit service secrets |
| High | Supply-chain inputs are mutable | Docker/application tags, action tags, apt inputs, browser artifacts, and unsigned release metadata | **Partially remediated**; base/PostgreSQL images and Playwright versions are pinned, but the application tag, apt repository, browser artifact, actions, and releases still need stronger provenance | Rebuilding the same commit can execute different code |
| High | Frontend dependency audit reported known vulnerabilities | The original lockfile produced 24 production findings | **Production remediated**; production audit is 0, while seven high development-toolchain findings remain | Build/runtime exposure depends on package reachability and build isolation |
| Medium | JWTs are accepted in query strings and stored in script-readable browser storage | `server/auth.go`, `web/src/lib/api.ts`, `web/src/lib/auth.ts` | **Partially remediated**; query tokens are restricted to required SSE GET routes, but URL/localStorage exposure remains | Tokens may leak through history, logs, referrers, or XSS |
| Medium | Workspace confinement was lexical and symlink-unsafe | Original `server/workspace.go` used path checks followed by ordinary filesystem calls | **Remediated** with descriptor-relative `os.Root` operations and regression tests | A workspace symlink could redirect authenticated file operations outside the workspace |
| Medium | Default container posture is privileged and broadly exposed | Dockerfile has no non-root `USER`; Compose mounts writable host directories | **Partially remediated**; UI bind defaults to loopback, but root execution and writable mounts remain | A service compromise has a larger host and network blast radius |
| Low/Medium | Database credentials could be exposed or malformed during local install | Original installer used permissive output defaults and raw string interpolation | **Remediated** with `umask 077`, input validation, escaping, no known default password, and fail-closed pulls | Other local users or malformed values could affect credentials/configuration |

## Supply-chain observations

- The checked-out `v0.3.15` tag and commit have no Git signature.
- Self-update restricts downloads to GitHub domains and verifies SHA-256, which is useful against corruption. The checksum and binary come from the same release trust domain, so this does not protect against a compromised maintainer/release account.
- `skills/api-recon/scripts/package-lock.json` uses `registry.npmmirror.com` URLs. Integrity hashes help, but an internal build should use an approved registry mirror and provenance policy.
- The repository contained no tracked ELF, PE, or Mach-O executable and no active Git hook. The only large tracked binary found was an image asset.
- Secret-pattern and bidirectional-Unicode scans found no real embedded credential or source-obfuscation marker; matches were test fixtures.

## Positive controls

- Most API routes are protected by JWT middleware.
- Initial administrator creation is protected by database uniqueness/race handling.
- Notification delivery contains SSRF and cross-host redirect protections and redacts credential-bearing URLs.
- Skill archive extraction applies path, entry-count, and size limits.
- Self-update restricts allowed hosts, requires HTTPS, verifies hashes, smoke-tests the candidate, and supports rollback.
- The codebase has extensive behavior and regression tests around authentication, intercept decisions, notification security, task concurrency, and update behavior.

## Required gates before internal production use

- [ ] Build and run in a dedicated, disposable VM or hardened container host.
- [ ] Pin container base images, npm packages, GitHub Actions, and released artifacts by immutable digest or commit.
- [x] Remove `curl | sh` build/install paths from the approved deployment workflow.
- [x] Use descriptor-relative `os.Root` workspace operations, reject symlink components and leaf symlinks, and add regression tests.
- [x] Restrict query-string authentication to the minimum SSE endpoints; replacing URL tokens entirely remains preferred.
- [ ] Prevent autonomous creation of executable tools without explicit human approval.
- [ ] Run tool processes in a sandbox with an explicit environment allowlist and egress policy.
- [x] Upgrade audited frontend dependencies and obtain a clean production dependency audit. Seven development-only `shadcn` toolchain findings remain documented.
- [ ] Run the service as non-root with dropped capabilities, read-only root filesystem, bounded writable volumes, and explicit network bindings.
- [ ] Disable in-app self-update; promote signed, reviewed builds through an internal registry.
- [ ] Store secrets in a dedicated secret manager; rotate all evaluation credentials before production.
- [ ] Capture a clean runtime egress baseline under representative tasks and alert on new destinations.

## Review limits

This review inspected the checked-in source, scripts, dependency manifests, Git metadata, executable files, outbound endpoints, selected security-sensitive control paths, npm advisories, and reachable Go vulnerabilities. It did not prove dependency source integrity, inspect the published Docker image or release binaries, perform dynamic sandbox/egress testing, or audit the external `norma` dependency line by line. Those are mandatory follow-up checks before a strong absence-of-backdoor claim.

See [Architecture](architecture.en.md) for the component and trust-boundary map.
