# Owen Browser Bridge Agent Instructions

이 저장소는 Owen Browser Bridge VS Code extension과 브라우저 캡처 확장 프로젝트다.

## Knowledge Source

VS Code에서는 이 프로젝트와 `C:\OWEN\github\wiki`를 멀티 루트 워크스페이스로 함께 연다.

- `C:\OWEN\github\wiki`를 디자인·지식 참고 루트로 상시 취급한다.
- UI/UX, 접근성, 반응형 또는 컴포넌트 작업 전 `lib/ui-foundation/`, `lib/ui-lab/src/`, 관련 `lib/ui-foundation/REFERENCE-STUDY-*.md`를 작업 용어로 검색하고 해당 소스를 확인한다.
- 사용자가 명시적으로 요청하지 않으면 `C:\OWEN\github\wiki`의 파일은 읽기 전용으로 유지한다.
- `C:\OWEN\github\wiki`에 접근할 수 없으면 추측으로 대체하지 않고, 검증하지 못한 사실을 완료 보고에 명시한다.

브라우저 제어, 포털 증거 수집, Microsoft Security 시나리오는 wiki를 먼저 참조한다.

```powershell
Push-Location C:\OWEN\github\wiki
.\.venv\Scripts\python.exe scripts\wiki-query.py "Owen Browser Bridge browser capture" --limit 7 --json
Pop-Location
```

우선 참조:

- `wiki/wiki/concepts/owen-browser-bridge-copilot-browser-control.md`
- `wiki/wiki/concepts/ui-design-system-knowledge.md`
- `wiki/AGENTS.md`의 Owen Browser Bridge 운영 메모

<!-- ui-portal-usage:start -->
## Owen UI Portal 사용

- UI/UX, frontend, component, 접근성, 반응형 또는 시각 자산 작업을 계획하거나 편집하기 전 companion WIKI의 UI Portal을 task-specific 자산 선택의 기본 라우터로 사용한다.
- WIKI 루트는 멀티루트 workspace의 `wiki`, sibling `../wiki`, 현재 플랫폼의 알려진 WIKI 경로 순서로 찾으며 하나의 절대 경로만 가정하지 않는다.
- 구현용 선택은 WIKI 루트에서 `node scripts/ui-portal/query-assets.mjs brief "<한 문장의 output job>" --limit 5`를 실행하고 Task Profile, Context Pack, exact Asset ID, `ownerPath`/`ownerApi`, maturity와 validation을 확인한다. broad Registry를 모델 컨텍스트에 넣거나 Asset ID를 추측하지 않는다.
- 시각 검토는 WIKI의 `process: UI Portal Controller`를 실행·재사용하고 VS Code 내장 브라우저에서 `/uiportal query="<작업>"` 또는 `http://127.0.0.1:4172/portal/`을 연다.
- Portal은 라우팅·증거 surface이고 Foundation의 `DESIGN.md`와 owning source가 최종 계약이다. WIKI는 명시적 요청이 없으면 읽기 전용으로 유지하며, 접근할 수 없으면 미검증 범위를 보고한다.
<!-- ui-portal-usage:end -->

## UI Direction

UI 작업 전 sibling workspace folder `wiki`의 `wiki/concepts/ui-design-system-knowledge.md`를 우선 참조한다.
디자인/프론트엔드 작업을 시작하기 전 `C:\OWEN\github\wiki\lib\ui-foundation`의 `README.md`, `DESIGN.md`, `tokens/`, `src/` 컴포넌트 계약을 읽고 현재 프로젝트에 맞게 적용한다.

기본 조합:

- Extend-UI / shadcn component structure
- Owen Graphite Liquid Glass visual surface
- Reicon for richer icon options
- Border Beam only for focused emphasis
- Boneyard only for data-heavy app skeleton loading

## Project Commands

```powershell
npm run compile
npm run lint
npm run test
npm run package
npm run release:check
npm run release:local
```

## Local Rules

- 신기능 추가 시 README와 `docs/ai-agent-browser-control-guide.md`를 함께 업데이트한다.
- GitHub Release 전 `npm run release:local`로 검증, 패키징, 로컬 VS Code VSIX 설치까지 완료한다.
- 비밀번호, MFA, 토큰, 쿠키, bearer token은 채팅으로 요청하거나 입력하지 않는다.
- capture/screenshot은 민감정보 redaction을 고려하고 git commit 대상에서 제외한다.
- destructive browser action은 preview/guard/review 흐름을 유지한다.

<!-- ui-foundation-design-guide:start -->
## UI Foundation Lab 디자인 가이드

- 모든 UI 설계·구현 전에 [UI-FOUNDATION-DESIGN-GUIDE.md](UI-FOUNDATION-DESIGN-GUIDE.md)를 먼저 읽는다.
- UI Foundation Lab 왼쪽 패널의 26개 UI를 모두 `Priority 1` 디자인 후보로 취급한다.
- `Priority 1` 안에서는 Clear glass search, controls, workflow를 가장 먼저 검토한다.
- 나머지 Lab specimen을 검토한 뒤에만 앱 전용 신규 디자인이나 외부 reference를 고려한다.
- 이 프로젝트의 기존 제품 제약과 더 엄격한 접근성·runtime 규칙은 그대로 유지한다.
<!-- ui-foundation-design-guide:end -->
