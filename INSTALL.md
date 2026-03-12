# 설치 가이드

## 요구 사항

- **Node.js** 18 이상
- **pnpm** (npm/yarn도 가능하나 pnpm 권장)
- **Claude Code** CLI 설치 및 로그인 완료

## 1. 설치

```bash
# 저장소 클론
git clone https://github.com/wooo-jin/clinsight.git
cd clinsight

# 의존성 설치
pnpm install

# 빌드
pnpm build
```

## 2. Hook 등록

Claude Code에 세션 기록 Hook을 등록합니다.

```bash
pnpm setup
```

이 명령은 `~/.claude/settings.json`에 3개 Hook을 추가합니다:

| Hook 이벤트 | 동작 |
|---|---|
| `SessionStart` | 세션 아카이브 초기화 |
| `UserPromptSubmit` | 대화 내용 실시간 동기화 |
| `Stop` | 세션 종료 시 완전한 아카이브 생성 |

등록 상태를 확인하려면:

```bash
pnpm setup -- --status
```

Hook을 제거하려면:

```bash
pnpm setup -- --uninstall
```

## 3. 대시보드 실행

```bash
pnpm dev
```

빌드된 버전으로 실행:

```bash
node dist/cli.js
```

### 키보드 조작

| 키 | 동작 |
|---|---|
| `1`~`6` | 탭 전환 |
| `Tab` | 다음 탭 |
| `r` | 데이터 새로고침 |
| `s` | 세션 데이터 JSON 내보내기 |
| `q` | 종료 |

## 4. 자동 분석 설정 (선택)

매일 밤 23:00에 자동으로 Compound 분석을 실행합니다.

```bash
pnpm cron:install
```

- **macOS/Linux**: crontab에 등록
- **Windows**: schtasks(예약 작업)에 등록

자동 분석이 하는 일:
1. 당일 세션을 모두 로드
2. 효율 분석 실행
3. 일별 요약을 `~/.claude/clinsight/summaries/`에 저장
4. Claude Sonnet으로 패턴/솔루션/컨벤션 추출
5. 결과를 `~/.claude/clinsight/compounds/`에 저장

제거하려면:

```bash
pnpm cron:install remove
```

로그 확인 (macOS/Linux):

```bash
cat ~/.claude/clinsight/cron.log
```

## 5. 데이터 저장 위치

모든 데이터는 `~/.claude/clinsight/` 아래에 통합 저장됩니다.

| 경로 | 내용 |
|---|---|
| `~/.claude/clinsight/archive/` | 세션 대화 전문 아카이브 |
| `~/.claude/clinsight/sessions/` | 내보낸 세션 데이터 |
| `~/.claude/clinsight/summaries/` | 일별 요약 (크론잡) |
| `~/.claude/clinsight/compounds/` | Compound 분석 결과 |
| `~/.claude/clinsight/cron.log` | 크론잡 실행 로그 |

## 문제 해결

### Hook이 동작하지 않을 때

```bash
# 1. Hook 등록 상태 확인
pnpm setup -- --status

# 2. dist/hook.js 존재 여부 확인
ls -la dist/hook.js

# 3. 수동 테스트
echo '{"session_id":"test","cwd":"/tmp"}' | node dist/hook.js session-start
```

### 대시보드에 세션이 안 보일 때

- Claude Code로 최소 1회 이상 대화한 후 확인하세요
- `~/.claude/projects/` 디렉토리에 JSONL 파일이 있는지 확인하세요

### 크론잡이 실패할 때

```bash
# 로그 확인
tail -50 ~/.claude/clinsight/cron.log

# Lock 파일이 남아있으면 제거
rm ~/.claude/clinsight/.cron.lock

# 수동 실행 테스트
pnpm cron
```

## 제거

모든 설정을 깔끔하게 제거합니다:

```bash
# 1. Hook 제거
pnpm setup -- --uninstall

# 2. 크론잡 제거
pnpm cron:install remove

# 3. 데이터 삭제 (선택 — 모든 분석 데이터가 삭제됨)
# macOS/Linux:
rm -rf ~/.claude/clinsight
# Windows (PowerShell):
# Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\clinsight"
```
