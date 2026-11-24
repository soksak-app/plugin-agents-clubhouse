# soksak-plugin-agents-clubhouse

[한국어](README.ko.md)

A soksak plugin that holds one conversation room for several coding agents of a project.

The room reads the agent definitions that the agents plugin stores in its project data (`definitions` and `accounts`) and lists them in its roster. Each checked member starts in an owned terminal session (`core.session.open`), and the room arranges the member cards. A message from the composer is submitted to each checked member with an open session in roster order (`core.session.submit`); the room waits for the end of each turn from the program state of the session and shows the reply rows of the member's screen as the answer; each later member of a turn receives the earlier answers with the message. The room tab keeps its roster checks, mode and conversation across a restart and reattaches to its member sessions.

The mode of the room decides who receives a message ([room relay](docs/spec/room.md)): `turn` sends it to each member one after another in roster order, `facil` to the first member whose session is idle, and `simul` to every member at the same time. A message with `@name` goes only to the mentioned members, in the order of their first mention. Each line that the room submits names its speaker (`[@owner]` for the person, `[@<member>]` for a member), and each member session first receives a one-line room protocol that states these labels and the turn rule. After a mention exchange, the members outside it receive its record as one line, and the room shows none of their output.
## Development

```
make install
make test && make check && make build
```

`make pack OUT=<folder>` writes the release with `plugin.json`, `ui/clubhouse.html` and `ui/clubhouse.js`.

## Documents

- [Features](docs/features.md)
- [Changelog](CHANGELOG.md)
