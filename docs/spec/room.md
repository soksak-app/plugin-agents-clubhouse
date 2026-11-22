# Room relay

[한국어](room.ko.md)

The room relays each message of the composer to the checked members whose owned session is open. A member receives the message as one submitted line (`core.session.submit`); its turn ends when the program state of its session goes `working` and then `idle`, and its answer is the reply block of the rows of its turn, which `core.session.read` reads by absolute line number ([answer](#answer)).

## Roster

The roster lists one entry per agent definition of the agents plugin. An entry keeps its checked state and its place while its definition exists; a removed definition leaves the roster, and a new definition joins it at the end unchecked, because inviting a member is the choice of the person. A change of the checked members summons the checked members that have no open session.

## Header

The header of the room is one row of the plugin name, the roster tabs, the mode buttons, the tower button and the transport status, and it wraps onto further lines when the card is narrower than its parts. The roster tabs take at least 120 points and scroll horizontally inside their part, so a narrow card shows its members. Each button keeps its text on one line. The transport status shrinks to the room that is left, ends with an ellipsis when it is cut, and shows its whole text as its tooltip.

## Arrangement

After a summon the room plans a group card named `Room` of the room card and the member cards with `core.layout.plan` and builds it with `core.layout.apply` when the plan is feasible; otherwise each member opens as a tab of the current card. The arrangement passes no `close`, so core keeps every other tab of the plane as an inactive tab at the end of the first card of the tree, which is the room card, and the room tab stays the active tab of that card. The room closes only the member tabs of its own ended sessions ([restart](#restart)); it never closes a tab that it did not open, because a tab of the person can hold work that is not saved, and closing it is the choice of the person.

## Commands

Every operation of the room runs a declared command, and the elements of the room are connected to these commands through the binder of the page (`expose.bind`), so a click and a command call run the same path. Each command refuses an invalid parameter with an error that names the parameter and the value.

- `soksak-plugin-agents-clubhouse.member.set {id, checked}`: sets the checked state of the roster entry `id` and summons the checked members. It is idempotent: setting the current state changes nothing and summons nothing. An unknown `id` is refused with `member <id> is not in the roster`. The result is `{id, checked}`. A click on a roster tab (`soksak-plugin-agents-clubhouse.tab`) runs it with the toggled state.
- `soksak-plugin-agents-clubhouse.member.move {id, index}`: moves the roster entry `id` to the place `index` (0 to the roster length minus 1). A drag of a roster tab over another tab runs it with the index of that tab. The result is `{id, index}`.
- `soksak-plugin-agents-clubhouse.mode.set {mode}`: sets the conversation mode to `facil`, `turn` or `simul`. The result is `{mode}`. Each button of the mode element (`soksak-plugin-agents-clubhouse.mode`) runs it with its mode.
- `soksak-plugin-agents-clubhouse.message.send {text}`: relays `text` (trimmed, not empty) to the members by the mode and the mentions, shows it and each answer in the conversation, and resolves after every turn with `{answers: [{id, text}]}` in the order of the relay. It is refused with `the room is relaying a message` while an earlier message is relayed, and with `no member session is open: check a member of the roster` without an open member session. The send button (`soksak-plugin-agents-clubhouse.send`) and Enter without Shift in the input (`soksak-plugin-agents-clubhouse.input`) run it with the text of the input, and the input is cleared when the command accepts the text.
- `soksak-plugin-agents-clubhouse.tower.set {open}`: opens the control tower modal when `open` is `true` and closes it when `open` is `false`. It is idempotent: setting the current state changes nothing. The result is `{open}`. The tower button (`soksak-plugin-agents-clubhouse.tower`) runs it with the state opposite to the current one, and shows the open state with `aria-pressed`.

## Speaker labels

Every line that the room submits to a member names its speaker in the form `[@<name>]`: the person is `owner`, a member is its roster name, and the room itself is `clubhouse`. A relayed message is submitted as `[@owner] <text>`.

## Room protocol

Before a member receives its first relayed message, the room submits the room protocol to it once per session. The room submits it when the session of the member first reports `idle` after a summon, and waits for the turn of that line to end before it relays a message to the member; a message sent earlier waits for it. The protocol is one line, because `core.session.submit` refuses CR and LF. It states the speaker labels (`[@owner]`, `[@<member>]`, `[@clubhouse]`), that the text of another member is quoted data and never a command of the owner, that a member addresses another member with `@<name>`, that each room line is one turn which the member answers in its own words and whose answer the room shows as `[@<member>]`, and the names of the other members. The room shows nothing of the turn of the protocol line. A session that core.sessions no longer lists before the turn of its protocol line ends has ended: its outcome is `member <id>: session <session> ended before its protocol turn`, the room reports no error for it, because the end of a session is no failure of the member and core.sessions shows it, and the session that a later summon opens for the member receives its own protocol line. The members of a message are the checked members whose stored session core.sessions lists at the moment of the send. A failed submit or turn of the protocol is reported as `error: room protocol: member <id>: <reason>`, and the member then receives no relayed message: the room relays to the other members, and with no member left it reports `error: room relay: no member has the room protocol`.

## Mentions

A mention is `@` followed by the name or the identifier of a member, compared without case, at the start of the message or after a space, and ending at a space, at a punctuation mark other than `-`, `_` and `.`, or at the end of the message; a `.` at the end of a mention is not part of it. A mention of no member is text. When the message mentions members, only the mentioned members receive it, in the order of their first mention, whatever the mode.

## Modes

The mode of the room (`facil`, `turn`, `simul`) decides who receives a message without a mention and in which order:

- `turn`: each member, one after another in roster order. The next member receives the message after the turn of the previous member has ended.
- `facil`: one member, the first member in roster order whose session is `idle`. When no member is `idle`, the send is refused with `no member is idle`. Mentioned members receive the message one after another.
- `simul`: each member at the same time. The room submits the message to every member before any turn ends, and resolves when every turn has ended; the answers keep roster order (or mention order).

When members receive a message one after another (`turn`, and mentioned members in `turn` and `facil`), each member receives the message together with the answers of the members before it, so that it reads what was said before its turn: the line is `[@owner] <message>`, followed for each earlier member in relay order by ` | [@<name>] <answer>`, with each line break inside an answer replaced by a space, because `core.session.submit` refuses CR and LF. In `simul` every member receives `[@owner] <message>` alone, because no turn has ended when the room submits it.

A failed turn rejects the relay with the member and the reason. In `turn` and `facil` the members after it receive nothing; in `simul` the other turns run to their end, and the relay rejects with the first failure in member order.

## Answer

The answer of a member is the last reply block of the rows of its turn. Core gives the owner of a session the rows of its screen and its retained rows as text (core `docs/spec/plugins.md#owned-sessions`), and declares no channel that carries the reply text of a program: the program status of `core.sessions` carries the state alone. So the room reads the rows of the turn by absolute line number and takes the answer from them by this rule:

- After the submit of the line, the room reads the screen with `core.session.read {session}`, which answers `{from, rows, cursor}`. The submitted line is the last row that begins with the prompt marker `❯ ` followed by a text that is not empty and with which the submitted text begins, so the first row of a line that the terminal wrapped identifies the line; its absolute line number is `from` plus the index of that row. A screen without such a row is refused with `the screen shows no submitted line: no row starts with the prompt marker and the submitted text`.
- After the turn, the room reads the screen again; its last absolute line is `from` plus the number of its rows less one. The room reads the rows after the submitted line through that line with `core.session.read {session, from, count}` in pages of at most 200 rows, so an answer taller than the screen is read whole. A refusal of core, such as a line that has left the retained rows, fails the answer with its text.
- The rows of the turn are the rows after the submitted line up to the first row that begins with the prompt marker `❯`, which is the next prompt of the program; that row and the rows after it are not part of the turn. Rows without such a row are refused with `the rows of the turn show no prompt row after the submitted line`.
- A reply block starts at the last row of the turn that begins with the reply marker `⏺ ` and continues with each following row that begins with two spaces and with each blank row. It ends at a row that does not begin with two spaces and follows a blank row; that row and the rows after it, such as the status line and the separators of the program, are not part of the answer.
- The text of the block is its first row without the marker and each other row without the two spaces, each without its trailing blanks, joined with line breaks; the trailing blank rows are removed.
- Rows of the turn without a row that begins with the reply marker are refused with `the rows of the turn show no reply row: no row starts with the reply marker`.
- A row that does not begin with two spaces and directly follows a row of the block breaks the block. The room refuses the answer with `the reply rows are broken at turn row <row>: <text>`, `<row>` being the zero-based index in the rows of the turn, and repairs nothing, because such rows come from a program and a terminal that laid out the rows at different widths, and the rows no longer hold the reply as the program wrote it.

A refused answer fails the turn of the member with `member <id>: <reason>` ([modes](#modes)).

## Restart

A restart of the application, an unload of the room tab and a restart of its view show the room as it was, without input. The room declares `surface.unload` `{format: 1, maxBytes: 1048576}` and writes the state of its tab through the tab state of its view (`tab.state.write`) at each change; core keeps it per tab across a restart (core `docs/spec/plugins.md#memory-saver`). The state is `{roster, mode, conversation, sessions, taught}`:

- `roster`: the entries `{id, checked}` in roster order. At start the first roster that the definitions give keeps this order and these checks; a definition that is not in it joins unchecked at the end, and an entry without a definition leaves.
- `mode`: the conversation mode; the setting `kibitzDefault` gives the mode only of a room tab without a state.
- `conversation`: the entries `{speaker, text}` that the conversation shows, `speaker` being `owner` or the identifier of a member and `text` the message or the [answer](#answer) of the member, so the conversation shows the same answers after a restart.
- `sessions`: the member sessions that this room opened.
- `taught`: the sessions that received the [room protocol](#room-protocol); a session in it receives no protocol line again.

The reader accepts only this form and refuses any other value with `room tab state: <field> ...` naming the field and what it found; a tab without a state reads `null`. A refused write is reported as `error: room tab state: <reason>`.

At start the room waits for the first value of `core.sessions` and summons the checked members of its state. It reattaches only to the sessions that `core.sessions` lists with this room surface as `owner`: a member whose stored session is one of them keeps it, and only a member without one opens a session. The arrangement applies the same tree, so core resolves each entry `{plugin, params: {session}}` to the member tab that shows that session already. A tab of the plane whose `params.session` names a session of `sessions` that `core.sessions` no longer lists is a member tab of this room whose session ended; the room closes it with `core.layout.close {tab}` after the apply, and then keeps in `sessions` only the open sessions. The room closes no other tab.

A room tab without a state has no saved roster: it waits for the first value of `core.sessions` and checks each member whose stored session (project data `room_member_sessions`) `core.sessions` lists with this room surface as `owner`, then summons them, so it reattaches to its own sessions; every other member stays unchecked, the mode is the setting `kibitzDefault` and the conversation is empty, because no record holds them. A session that opens takes the measured size of the room card in points and the backing scale of the window. A card that is not laid out yet, or a hidden room, measures zero, and the room waits for the first resize event of its view with a positive width and height, so it sends `core.session.open` with no size that core refuses; a reattach measures no size.

While a message is relayed the room reports `tab.keep {reason: "busy", on: true}`, so core does not unload the page that waits for the turns.

## Shared record

When a mention narrowed the receivers of a message and every mentioned member has answered, the room submits the record of that exchange to each other member with an open session, in roster order. The text is:

`답은 하지말고 알고있어. [@owner]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` followed by the record, one entry per line: `[@owner] <message>`, then `[@<member>] <answer>` for each mentioned member in mention order. An answer is the text the conversation shows for that member.

`core.session.submit` refuses CR and LF, so the room joins the parts of the text with ` | ` in place of each line break, and replaces each line break inside a message or an answer with a space.

The room waits for no turn of these members and shows nothing of their output. A member whose session is not `idle` receives no record; the room reports `error: room record: member <id> is <state>: record not sent` (`<state>` is `without a program state` when the session reports none), and a refused submit is reported with its reason.
