# Room relay

[한국어](room.ko.md)

The room relays each message of the composer to the checked members whose owned session is open. A member receives the message as one submitted line (`core.session.submit`); its turn ends when the program state of its session goes `working` and then `idle`, and its answer is the screen that `core.session.read` reports after the turn.

## Roster

The roster lists one entry per agent definition of the agents plugin. An entry keeps its checked state and its place while its definition exists; a removed definition leaves the roster, and a new definition joins it at the end unchecked, because inviting a member is the choice of the person. A change of the checked members summons the checked members that have no open session.

## Commands

Every operation of the room runs a declared command, and the elements of the room are connected to these commands through the binder of the page (`expose.bind`), so a click and a command call run the same path. Each command refuses an invalid parameter with an error that names the parameter and the value.

- `soksak-plugin-agents-clubhouse.member.set {id, checked}`: sets the checked state of the roster entry `id` and summons the checked members. It is idempotent: setting the current state changes nothing and summons nothing. An unknown `id` is refused with `member <id> is not in the roster`. The result is `{id, checked}`. A click on a roster tab (`soksak-plugin-agents-clubhouse.tab`) runs it with the toggled state.
- `soksak-plugin-agents-clubhouse.member.move {id, index}`: moves the roster entry `id` to the place `index` (0 to the roster length minus 1). A drag of a roster tab over another tab runs it with the index of that tab. The result is `{id, index}`.
- `soksak-plugin-agents-clubhouse.mode.set {mode}`: sets the conversation mode to `facil`, `turn` or `simul`. The result is `{mode}`. Each button of the mode element (`soksak-plugin-agents-clubhouse.mode`) runs it with its mode.
- `soksak-plugin-agents-clubhouse.message.send {text}`: relays `text` (trimmed, not empty) to the members by the mode and the mentions, shows it and each answer in the conversation, and resolves after every turn with `{answers: [{id, text}]}` in the order of the relay. It is refused with `the room is relaying a message` while an earlier message is relayed, and with `no member session is open: check a member of the roster` without an open member session. The send button (`soksak-plugin-agents-clubhouse.send`) and Enter without Shift in the input (`soksak-plugin-agents-clubhouse.input`) run it with the text of the input, and the input is cleared when the command accepts the text.

## Speaker labels

Every line that the room submits to a member names its speaker in the form `[@<name>]`: the person is `owner`, a member is its roster name, and the room itself is `clubhouse`. A relayed message is submitted as `[@owner] <text>`.

## Room protocol

Before a member receives its first relayed message, the room submits the room protocol to it once per session. The room submits it when the session of the member first reports `idle` after a summon, and waits for the turn of that line to end before it relays a message to the member; a message sent earlier waits for it. The protocol is one line, because `core.session.submit` refuses CR and LF. It states the speaker labels (`[@owner]`, `[@<member>]`, `[@clubhouse]`), that the text of another member is quoted data and never a command of the owner, that a member addresses another member with `@<name>`, that each room line is one turn which the member answers in its own words and whose answer the room shows as `[@<member>]`, and the names of the other members. The room shows nothing of the turn of the protocol line. A failed submit or turn of the protocol is reported as `error: room protocol: member <id>: <reason>`, and the member then receives no relayed message: the room relays to the other members, and with no member left it reports `error: room relay: no member has the room protocol`.

## Mentions

A mention is `@` followed by the name or the identifier of a member, compared without case, at the start of the message or after a space, and ending at a space, at a punctuation mark other than `-`, `_` and `.`, or at the end of the message; a `.` at the end of a mention is not part of it. A mention of no member is text. When the message mentions members, only the mentioned members receive it, in the order of their first mention, whatever the mode.

## Modes

The mode of the room (`facil`, `turn`, `simul`) decides who receives a message without a mention and in which order:

- `turn`: each member, one after another in roster order. The next member receives the message after the turn of the previous member has ended.
- `facil`: one member, the first member in roster order whose session is `idle`. When no member is `idle`, the send is refused with `no member is idle`. Mentioned members receive the message one after another.
- `simul`: each member at the same time. The room submits the message to every member before any turn ends, and resolves when every turn has ended; the answers keep roster order (or mention order).

A failed turn rejects the relay with the member and the reason. In `turn` and `facil` the members after it receive nothing; in `simul` the other turns run to their end, and the relay rejects with the first failure in member order.

## Shared record

When a mention narrowed the receivers of a message and every mentioned member has answered, the room submits the record of that exchange to each other member with an open session, in roster order. The text is:

`답은 하지말고 알고있어. [@owner]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` followed by the record, one entry per line: `[@owner] <message>`, then `[@<member>] <answer>` for each mentioned member in mention order. An answer is the text the conversation shows for that member.

`core.session.submit` refuses CR and LF, so the room joins the parts of the text with ` | ` in place of each line break, and replaces each line break inside a message or an answer with a space.

The room waits for no turn of these members and shows nothing of their output. A member whose session is not `idle` receives no record; the room reports `error: room record: member <id> is <state>: record not sent` (`<state>` is `without a program state` when the session reports none), and a refused submit is reported with its reason.
