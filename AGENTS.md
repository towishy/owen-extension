# Owen Browser Bridge Agent Instructions

이 저장소는 Owen Browser Bridge VS Code extension과 브라우저 캡처 확장 프로젝트다.

## Knowledge Source

VS Code에서는 이 프로젝트와 `C:\OWEN\github\wiki`를 멀티 루트 워크스페이스로 함께 연다.

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

## UI Direction

UI 작업 전 sibling workspace folder `wiki`의 `wiki/concepts/ui-design-system-knowledge.md`를 우선 참조한다.

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
