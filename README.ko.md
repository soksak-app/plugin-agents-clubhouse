# soksak-plugin-agents-clubhouse

[English](README.md)

프로젝트의 여러 coding agent를 위한 대화 방 하나를 두는 soksak plugin이다.

방에는 agents plugin의 group 하나가 지정되고, 방의 member는 그 group의 member이며 각각 owned terminal session(`core.session.open`)으로 시작한다. 입력창의 메시지는 `@이름`이나 `@all`로 mention한 member에게, 그다음 group의 leader에게 가고, mention이 없는 메시지는 leader에게만 간다. 각 member는 선언된 answer command로 답하고, 방은 대화를 보여 주며 restart 너머로 tab의 group, mode, 대화를 유지한다([room](docs/spec/room.ko.md)).

## 개발

```
make install
make test && make check && make build
```

`make pack OUT=<folder>`는 `plugin.json`, `ui/clubhouse.html`, `ui/clubhouse.js`를 담은 release를 쓴다.

## 문서

- [Features](docs/features.ko.md)
- [변경 기록](CHANGELOG.ko.md)
