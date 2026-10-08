> 언어: [중국어](VALIDATION.md) | [English](VALIDATION.en.md) | 한국어

# `/btw` 검증 기록

날짜: 2026-09-10. 브랜치: `codex/btw-side-question`. 기준선: `8dae851b9b622f2ff2631f332fde9719d0b16fba`.

독립 PostgreSQL 테스트 데이터베이스와 데이터 디렉터리를 사용했습니다. 실제 모델 자격 증명은 격리된 테스트 환경에만 주입했고 코드나 이 기록에 쓰지 않았으며 제품 기본 모델도 변경하지 않았습니다. Go 1.26.3, norma v0.3.6, Next.js 16.2.9입니다.

실제 모델 대화, 반환 객체, 엔지니어링 단언 및 Qwen 원문 검토는 [validation-2026-09-10.json](validation-2026-09-10.json)에 저장되어 있으며 API 자격 증명은 포함하지 않습니다.

## 엔지니어링 검사

| 범위 | 결과 | 증거 |
| --- | --- | --- |
| 구조화 메시지와 도구 파라미터 깊은 복사 | 통과 | `TestCheckpointDeepCopyAndBoundaries` |
| 요약/압축 요청이 덮어쓰지 않음, 완전한 응답과 종단 상태 게시, 일부 응답 제외 | 통과 | `TestCheckpointDeepCopyAndBoundaries`, `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| 실제 모델 풀 구성원 ID | 통과 | `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| 도구 짝, 20개 묶음 재생, 예산 절삭과 초과 오류 | 통과 | `TestBuildRequestCompactionToolPairingAndBudget` |
| 주/우회 병렬 실행과 양방향 취소 격리 | 통과 | 블로킹 Provider, `TestMainSideConcurrencyAndIndependentCancellation` |
| 도구 미실행, 스트리밍/비스트리밍, 실패 시 사용량 | 통과 | `TestServiceNoToolsAndUsageOnFailure` |
| 실제 norma ChatAgent + 로컬 Read 도구, 주 transcript/활동 격리 | 통과 | `TestSideActualChatCheckpointToolResultAndTranscriptIsolation`, 스트리밍 및 비스트리밍 하위 케이스 |
| 영속화, 페이지네이션, 멱등성, 재시작 후 일부 답변 보존 | 통과 | `TestSideHistoryIdempotencyPagingAndRecovery` |
| 비우기/지연 쓰기 경쟁, 부모 삭제, 버전 비교 | 통과 | `TestSideClearLateWritersAndDeletedParent` |
| MainAgent/Worker 보관 및 복구, v1/v2/v3 | 통과 | `TestSideTaskArchiveVersions` |
| 세 부모 인터페이스, 인증, 리소스 소유권, Worker 논리 삭제 | 통과 | `TestSideHTTPGlobalLimitTaskWorkerAndDeletion`, `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| 사용 중인 주 세션에서도 우회 가능, 독립 SSE 재연결/단절·취소·비우기 | 통과 | `TestSideHTTPBusyIsolationClearAndReconnect` |
| 부모당 동시 요청 1개 / 전역 4개 | 통과 | 두 개의 `TestSideHTTP…` 케이스 |
| 제출 전 스냅샷 저장, 재시작 후 이어 묻기, 기존 세션의 스냅샷 위조 방지 | 통과 | `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| 캐시 설정 삭제 또는 모델 변경 후 계속 진행 거부 | 통과 | `TestSideRejectsDeletedOrChangedCachedProfile` |
| 보관 전 최종 답변과 사용량 저장을 위해 취소 및 대기 | 통과 | `TestSideTaskDrainPersistsBeforeArchive` |
| 스트리밍 소비자 조기 취소 시 사용량을 한 번만 기록하고 우회 소유권 유지 | 통과 | `TestSideUsageRecordedOnceOnConsumerCancellation` |
| 재시작 후 복구된 Worker/실행 deadline 컨텍스트가 새 스냅샷 게시를 계속함 | 통과 | `TestSideRestoredWorkerRuntimePublishesNewCheckpoint` |
| 관련 패키지 race 검사 | 통과 | 아래 명령 |
| TypeScript 및 프로덕션 빌드 | 통과 | `npx tsc --noEmit`, `npm run build` |
| 새 프론트엔드 모듈의 Biome | 통과 | `biome check`, 새 모듈 3개 |

별도의 폐기 가능한 데이터베이스에 `ARTEX_PG_DSN`을 설정하면 자동화 검사를 재현할 수 있습니다(프로덕션 DB를 가리키지 마십시오).

```sh
go test -race ./agent ./db ./server ./sidequestion ./llmrec ./llmpool \
  -run 'Test(Side|Checkpoint|Snapshot|BuildRequest|Service|MainSide|CaptureRun|TaskArchive|CompleteForwards|StopIntent|CancelIntent)' -count=1
cd web
npx tsc --noEmit
npx biome check src/lib/side-questions.ts src/hooks/use-side-questions.ts src/components/side-question-workspace.tsx
npm run build
```

전체 Go 회귀 테스트가 모두 통과하지는 않습니다. 기존 `server` 테스트 두 개가 임시 디렉터리 정리 단계에서 `TempDir RemoveAll … directory not empty`를 보고하며 실패합니다.

- `TestInheritedActivityDetailAndRelationDeletion`
- `TestTaskMetadataPatchReturnsRenameAndPin`

수정하지 않은 기준선에서 소스를 내보내 같은 격리 환경으로 `server` 패키지를 다시 실행했을 때도 두 정리 실패가 재현되었습니다. 기준선 실행에서는 `TestCoreTaskLifecyclePG`의 대상 노드 수 단언 실패도 나타났지만 최종 수정 후 `server` 회귀에서는 나타나지 않았습니다. 다른 패키지는 통과했고 이번 우회 관련 케이스와 race 검사도 통과했습니다. 기준선 문제는 이번 인수 통과로 계산하지 않았으며 숨은 문제를 이유로 기존 단언을 수정하지 않았습니다.

Next.js 빌드는 기존의 여러 lockfile/workspace root 추론 경고를 출력했지만 빌드가 완료되었고 모든 페이지가 생성되었습니다.

## 브라우저 검사

Codex 인앱 브라우저를 독립 로컬 Go 서비스와 Next.js 개발 서버에 연결했습니다. 데스크톱 및 390 × 844 좁은 화면에서 다음 작업을 수행하고 스크린샷과 브라우저 로그를 확인했습니다.

- 일반 채팅 실행 중 `/btw`를 제출하고 주 콘텐츠와 우회 질문이 동시에 표시되는지 확인했으며 데스크톱 사이드바가 정상 작동했습니다.
- 연속 질문을 수행했습니다. 우회 질문을 중지한 뒤 생성된 일부 답변이 남고 주 흐름이 계속되었습니다.
- 패널을 닫아도 요청이 계속되었고 다시 열면 완료 답변이 복원되었습니다. 페이지를 새로 고친 뒤 빈 `/btw`로 기록을 복원했습니다.
- 좁은 화면 Drawer의 입력, 버튼, 기록과 닫기 동작이 가로 넘침 없이 정상 작동했습니다.
- 비우기는 확인 대화상자를 사용했고, 비운 후 기록은 사라졌지만 주 transcript와 스냅샷은 남았습니다.
- 작업 MainAgent와 두 Worker에 각각 질문하고 전환했으며 Agent 레이블과 기록이 섞이지 않았습니다.
- 블로킹 로컬 모델 fixture로 Worker 실행을 유지했습니다. Worker 주 입력창에서 `/btw`를 제출하고 우회 질문을 중지한 뒤 Worker가 실시간 실행과 자신의 일시정지 버튼을 계속 표시하며 우회 질문이 일부 답변을 저장하는지 확인했습니다.
- 브라우저 오류/경고 로그는 비어 있었습니다.

실제 모델 응답 속도에 의존하지 않고 동시성 시점을 정확히 검증하기 위해 제어 가능한 fixture를 사용했습니다. 초기 Worker 실행 확인 두 번은 작업이 끝났거나 답변이 일찍 끝나 유효한 동시성 구간이 만들어지지 않았습니다. fixture를 수정한 뒤 다시 수행해 통과했으며 초기 작업은 유효한 통과로 계산하지 않습니다.

## 실제 모델 대화

OpenAI 호환 엔드포인트 `http://127.0.0.1:12580/tingly/openai`에서 `grok-4.6`을 우선 탐색했습니다. 탐색은 2.82초 만에 HTTP 200, 모델명 `grok-4.6`, `READY`를 반환했습니다. 우선 엔드포인트를 사용할 수 있었으므로 Tingly `glm`과 Zhipu `glm-5.3` 대체 서비스는 활성화하거나 검증하지 않았습니다.

| 시나리오 | 실제 결과 |
| --- | --- |
| 주 세션 실행 중 자산, 대상, 마커를 질문 | `redhaze.top`, 홈 페이지 읽기와 요약 목표, `BTW-REAL-0910`을 반환; 우회 질문은 16.97초에 완료 |
| 주 세션이 홈 페이지를 읽은 후 도구 근거 질문 | WebFetch 200, curl 리디렉션 301 → 302 → 200, 페이지 제목을 정확히 인용; 7.24초 |
| 우회 질문에 Bash로 테스트 파일을 만들도록 요청 | 실행을 거부했고 대상 파일은 만들어지지 않음; 7.74초 |
| 완료된 우회 질문이 주 컨텍스트를 변경하지 않음 | 주 transcript SHA-256과 주 활동 기록이 유지되었고 우회 도구 실행 횟수는 0 |
| Go 서비스를 실제로 중지/재시작한 후 다시 질문 | 이전 우회 기록 3개를 보존하고 주 Agent를 다시 실행하지 않고 영속 스냅샷에서 자산, 마커와 제목에 답변 |
| Grok 비스트리밍 설정을 사용하는 새 세션 | 자산과 `ATOMIC-0910`을 정확히 답변; 반환·저장된 사용량: input 11734, output 138, cache_read 11520 |

자산 사례의 주 세션은 WebFetch와 Bash/curl로 공개 홈 페이지를 읽었습니다. 랜딩 페이지는 `https://id.redhaze.top/home`, 제목은 “红幕科技 RedHaze Group · 全球综合集团门户”였습니다. Bash가 응답을 로컬 테스트 파일에 임시 저장했으며 원격 쓰기는 수행하지 않았습니다. 이 사실은 우회 질문이 도구를 실행하지 않았다는 사실과 별도로 검증했습니다.

주 transcript 체크섬: `e7e61f135a4a120954b539f357e8c4205d7d5cd7460dcaf3dc0fd066463e1d00`.

**사용량 제한:** Tingly의 Grok 스트리밍 응답은 usage를 반환하지 않았습니다. `stream_options.include_usage=true`를 포함한 별도 직접 요청은 HTTP 200, 데이터 프레임 12개, usage 프레임 0개를 반환했습니다. 따라서 스트리밍 테스트의 0은 엔드포인트가 사용량을 제공하지 않았다는 뜻이며 과금이 없었다는 뜻이 아닙니다. 비스트리밍 사용량과 fixture의 실패/취소 사용량은 올바르게 저장되었습니다.

## Qwen 검토

검토 모델은 OpenAI 호환 엔드포인트 `https://dashscope.aliyuncs.com/compatible-mode/v1`의 `qwen-flash`이며 HTTP 200을 반환했습니다. 최초 세 개의 실제 우회 대화, 주 세션 도구 근거 및 엔지니어링 단언을 제공했고 `verdict: accept`, `concerns: []`를 반환했습니다. 자산, 마커 및 페이지 읽기 근거와 답변이 일치하며 우회 도구 거부가 제약을 준수한다고 판단했습니다. 검토 사용량은 prompt 6625, completion 312, total 6937입니다.

이 Qwen 검토에는 이후 추가된 서비스 재시작과 비스트리밍 테스트가 포함되지 않았습니다. Qwen의 “쓰기 없음”이라는 요약은 너무 넓었습니다. 위에서 명시했듯 주 세션 curl은 로컬 임시 응답 파일을 실제로 만들었습니다. 동시성, 도구 실행 0회, transcript 격리는 모델 검토가 아니라 엔지니어링 단언으로 확인했습니다.
