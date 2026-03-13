<p align="center">
  <img src="assets/banner.svg" alt="Clinsight" width="700">
  <br><br>
  <strong>Claude Code 세션을 자동으로 기록하고, 분석하고, 복리화하는 TUI 대시보드</strong>
</p>
<p align="center">
  <p align="center">
    <a href="#quickstart">Quick Start</a> &middot;
    <a href="INSTALL.md">설치 가이드</a> &middot;
    <a href="#features">기능</a> &middot;
    <a href="#how-it-works">작동 원리</a> &middot;
    <a href="README.md">English</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue" alt="Platform">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
    <img src="https://img.shields.io/badge/tests-109%20passed-brightgreen" alt="Tests">
  </p>
</p>

---

## 왜 만들었나

Claude Code를 쓰다 보면 이런 경험, 한 번쯤 있을 겁니다.

> *"어제 Claude랑 뭘 논의했더라..."*
> *"세션이 날아가서 처음부터 다시 설명하고 있다"*
> *"그 프롬프트 또 써먹을 수 있는데... 뭐였더라"*
> *"한 세션에 $30 넘게 쓴 걸 뒤늦게 발견했다"*

세션은 휘발되지만, 거기서 얻은 경험까지 휘발될 필요는 없습니다.

**Clinsight는 당신의 Claude Code 사용을 자동으로 기록하고 분석해서, 오늘의 삽질을 내일의 자산으로 바꿉니다.**

---

<h2 id="quickstart">Quick Start</h2>

### npm (권장)

```bash
npm install -g clinsight

# Claude Code에 Hook 등록 (세션 자동 기록 시작)
clinsight-setup

# 대시보드 실행
clinsight
```

### 소스에서 설치

```bash
git clone https://github.com/wooo-jin/clinsight.git
cd clinsight
pnpm install && pnpm build

# Claude Code에 Hook 등록
pnpm setup

# 대시보드 실행
pnpm dev
```

상세한 설치 과정은 [INSTALL.md](INSTALL.md)를 참고하세요.

---

<h2 id="features">Features</h2>

### 1 &mdash; 자동 세션 아카이브

Claude Code의 Hook 시스템에 연결되어 **모든 대화를 자동으로 기록**합니다.
세션이 시작되면 기록이 시작되고, 끝나면 완전한 아카이브가 생성됩니다.
별도 조작 없이, 그냥 Claude Code를 쓰면 됩니다.

### 2 &mdash; TUI 대시보드

터미널에서 바로 확인하는 7개 탭 대시보드:

```
╭─────────────────────────────────────────────────────────╮
│  Clinsight  | 42 sessions | updated 17:30               │
│                                                         │
│  📊 Dashboard  💡 Insights  📋 Sessions                 │
│  💰 Cost       📦 Compound  📂 Archive                  │
│                                                         │
│  ┌─ 📊 오늘 ──┐  ┌─ 📊 이번 주 ┐  ┌─ 📊 이번 달 ─┐    │
│  │ 세션: 8     │  │ 세션: 34    │  │ 세션: 142     │    │
│  │ 비용: $4.20 │  │ 비용: $18.5 │  │ 비용: $72.30  │    │
│  │ 효율: 82    │  │ 효율: 78    │  │ 효율: 75      │    │
│  └─────────────┘  └─────────────┘  └───────────────┘    │
│                                                         │
│  🔥 7일 비용 추이   ▁▃▅▂▇▄▃                             │
│  📈 7일 효율 추이   ▅▆▃▇▅▆▇                             │
│                                                         │
│  [1-6] 탭 전환  [Tab] 이동  [r] 새로고침  [q] 종료      │
╰─────────────────────────────────────────────────────────╯
```

| 탭 | 설명 |
|---|---|
| **Dashboard** | 오늘/주간/월간 요약, 비용 추이 그래프, 효율 점수 |
| **Insights** | 삽질 탐지, 컨텍스트 포화도 경고, 개선 제안 |
| **Sessions** | 세션별 상세 분석 (토큰, 도구 사용, 편집 파일) |
| **Cost** | 모델별/프로젝트별 비용 분석 |
| **Compound** | AI 기반 패턴 추출 및 복리화 |
| **Archive** | 저장된 세션 대화 전문 조회 |
| **Settings** | 아카이브 보관 기간 설정 |

### 3 &mdash; 세션 분석 엔진

각 세션을 자동으로 분석해서 **효율 점수**(0-100)를 매깁니다.

```
효율 점수 = f(1회 해결률, 삽질 지수, 탐색 효율, 컨텍스트 포화도, 세션 시간)
```

| 지표 | 측정 방식 |
|---|---|
| **삽질 지수** | 편집을 되돌린 횟수 (단순 반복 편집 ≠ 삽질) |
| **탐색 효율** | 읽기만 하고 편집에 기여하지 않은 파일 비율 |
| **컨텍스트 포화도** | 200K 윈도우 대비 실제 사용량 |
| **1회 해결률** | 되돌림 없이 완료된 편집 비율 |
| **비용 추적** | 모델별 실제 토큰 단가 기반 |

### 4 &mdash; Compound (복리화)

매일 밤 크론잡이 그날의 세션을 Claude에게 보내 심층 분석합니다.

```
오늘의 세션들  ──→  패턴 인식      ──→  CLAUDE.md에
                    솔루션 축적           적용 가능한
                    컨벤션 추출           예방 규칙 생성
                    골든 프롬프트 보존
```

> **오늘의 삽질이 내일의 자산이 됩니다.**

### 5 &mdash; 실시간 알림

매 프롬프트마다 현재 세션을 분석합니다. 문제가 감지되면 Claude의 컨텍스트에 경고를 자동 주입하여, Claude가 응답에 자연스럽게 반영합니다.

| 조건 | Claude가 말해주는 것 |
|---|---|
| 컨텍스트 75%+ | "곧 /compact가 필요할 수 있습니다" |
| 컨텍스트 90%+ | "/compact 실행을 권장합니다" |
| 비용 $10+ | "비용이 높아지고 있습니다" |
| 되돌림 3회+ | "접근 방식을 재검토하는 것이 좋겠습니다" |
| 60분+ 세션 | "40-50분 단위 세션이 효율적입니다" |

별도의 알림창이 뜨는 게 아닙니다. Claude가 알아서 언급해줍니다.

### 6 &mdash; 좀비 세션 탐지

고아 프로세스나 방치된 세션 디렉토리를 찾아내고 정리합니다.

---

<h2 id="how-it-works">How It Works</h2>

```
Claude Code Session
       │
       ├── SessionStart ──→ Hook ──→ 아카이브 초기화
       │
       ├── PromptSubmit ──→ Hook ──→ 대화 동기화 + 실시간 분석
       │                              │
       │                              └──→ 경고 조건 충족 시
       │                                    Claude 컨텍스트에 주입
       │
       └── SessionStop ──→ Hook ──→ 완전한 아카이브 생성
                                         │
                                    ┌─────┴─────┐
                                    │           │
                              TUI 대시보드   크론잡 (23:00)
                              실시간 조회     Compound 분석
                                              패턴/솔루션 추출
```

---

## Tech Stack

| | |
|---|---|
| **Runtime** | Node.js 18+ |
| **UI** | Ink + React (Terminal UI) |
| **Language** | TypeScript strict mode |
| **Architecture** | Feature-Sliced Design (FSD) |
| **Integration** | Claude Code Hooks |
| **Test** | Vitest (109 tests) |
| **Platform** | macOS, Linux, Windows |

---

## License

[MIT](LICENSE)
