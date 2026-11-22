# soksak-plugin-agents-clubhouse

[한국어](README.ko.md)

A soksak plugin that holds one conversation room for several coding agents of a project.

The room reads the agent definitions that the agents plugin stores in its project data (`definitions` and `accounts`) and lists them in its roster. Each checked member starts in an owned terminal session (`core.session.open`), and the room arranges the member cards. A message from the composer is submitted to each checked member with an open session in roster order (`core.session.submit`); the room waits for the end of each turn from the program state of the session and shows the member's screen as the answer.

The mode button offers three conversation modes (facilitator, sequential, simultaneous). The relay does not apply them yet: the members always answer one after another. `@name` mentions are not built. The control tower (`tower.*` commands) plans, checks and runs natural-language requests as declared commands.

## Development

```
make install
make test && make check && make build
```

`make pack OUT=<folder>` writes the release with `plugin.json`, `ui/clubhouse.html` and `ui/clubhouse.js`.

## Documents

- [Features](docs/features.md)
- [Control tower](docs/CONTROL-TOWER.md)
- [Changelog](CHANGELOG.md)
