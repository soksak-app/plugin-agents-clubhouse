# soksak-plugin-agents-clubhouse

[English](README.md)

프로젝트의 여러 coding agent를 위한 대화 방 하나를 두는 soksak plugin이다.

방은 agents plugin이 project data(`definitions`, `accounts`)에 저장한 agent 정의를 읽어 roster에 보여 준다. 체크된 member는 각각 owned terminal session(`core.session.open`)으로 시작하고, 방은 member card를 배치한다. 입력창의 메시지는 열린 session이 있는 체크된 member마다 roster 순서로 submit된다(`core.session.submit`). 방은 session의 program 상태로 각 turn의 끝을 기다리고, member의 화면을 답으로 보여 준다.

Mode 버튼은 세 가지 대화 mode(facilitator, sequential, simultaneous)를 제공한다. Relay는 아직 이를 적용하지 않아 member는 항상 차례로 답한다. `@이름` mention은 만들지 않았다. Control tower(`tower.*` command)는 자연어 요청을 선언된 command로 계획하고 검사하고 실행한다.

## 개발

```
make install
make test && make check && make build
```

`make pack OUT=<folder>`는 `plugin.json`, `ui/clubhouse.html`, `ui/clubhouse.js`를 담은 release를 쓴다.

## 문서

- [Features](docs/features.ko.md)
- [Control tower](docs/CONTROL-TOWER.ko.md)
- [변경 기록](CHANGELOG.ko.md)
