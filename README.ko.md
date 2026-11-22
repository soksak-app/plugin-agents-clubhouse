# soksak-plugin-agents-clubhouse

[English](README.md)

프로젝트의 여러 coding agent를 위한 대화 방 하나를 두는 soksak plugin이다.

방은 agents plugin이 project data(`definitions`, `accounts`)에 저장한 agent 정의를 읽어 roster에 보여 준다. 체크된 member는 각각 owned terminal session(`core.session.open`)으로 시작하고, 방은 member card를 배치한다. 입력창의 메시지는 열린 session이 있는 체크된 member마다 roster 순서로 submit된다(`core.session.submit`). 방은 session의 program 상태로 각 turn의 끝을 기다리고, member 화면의 reply 행을 답으로 보여 준다. 차례로 받는 뒤 member는 앞 답을 메시지와 함께 받는다. 방 tab은 restart 너머로 roster check, mode, 대화를 유지하고 member session에 다시 붙는다.

방의 mode가 메시지를 누가 받는지 정한다([room relay](docs/spec/room.ko.md)). `turn`은 roster 순서로 member마다 차례로, `facil`은 session이 idle인 첫 member에게, `simul`은 모든 member에게 동시에 보낸다. `@이름`이 있는 메시지는 mention된 member에게만 처음 mention된 순서로 간다. 방이 submit하는 모든 줄은 화자를 밝히고(사람은 `[@owner]`, member는 `[@<member>]`), 모든 member session은 먼저 이 label과 turn 규칙을 말하는 한 줄짜리 room protocol을 받는다. Mention 대화 뒤에는 그 밖의 member가 대화 기록을 한 줄로 받고, 방은 그들의 출력을 보여 주지 않는다. Control tower(`tower.*` command)는 자연어 요청을 선언된 command로 계획하고 검사하고 실행한다.

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
