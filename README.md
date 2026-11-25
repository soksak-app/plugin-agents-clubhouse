# soksak-plugin-agents-clubhouse

[한국어](README.ko.md)

A soksak plugin that holds one conversation room for several coding agents of a project.

A room is assigned one group of the agents plugin, and its members are the members of that group, each started in an owned terminal session (`core.session.open`). A message of the composer goes to the members that it mentions with `@name` or `@all` and then to the leader of the group, and a message without a mention goes to the leader alone. Each member answers through the declared answer command, and the room shows the conversation and keeps the group, the mode and the conversation of its tab across a restart ([room](docs/spec/room.md)).

## Development

```
make install
make test && make check && make build
```

`make pack OUT=<folder>` writes the release with `plugin.json`, `ui/clubhouse.html` and `ui/clubhouse.js`.

## Documents

- [Features](docs/features.md)
- [Changelog](CHANGELOG.md)
