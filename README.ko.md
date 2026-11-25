# soksak-plugin-agents-clubhouse

[English](README.md)

프로젝트의 여러 coding agent를 위한 대화 방 하나를 두는 soksak plugin이다.

방에는 agents plugin의 group 하나가 지정되고, 방의 member는 그 group의 member이며 각각 owned terminal session(`core.session.open`)으로 시작한다. 입력창의 메시지는 방의 mode인 `turn` 또는 `simul`에 따라 member에게 가고, mention `@이름`은 mention된 member에게 첫 turn을 준다. group의 leader는 모든 줄을 받는다. 각 member는 선언된 answer command로 답하고, 방은 대화를 보여 주며 restart 너머로 tab의 group, mode, 대화를 유지한다([room](docs/spec/room.ko.md)).

## 개발

```
make install
make test && make check && make build
```

`make pack OUT=<folder>`는 `plugin.json`, `ui/clubhouse.html`, `ui/clubhouse.js`를 담은 release를 쓴다.

## 문서

- [Features](docs/features.ko.md)
- [변경 기록](CHANGELOG.ko.md)
