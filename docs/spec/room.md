# Room relay

[한국어](room.ko.md)

The room relays each message of the composer to the checked members whose owned session is open. A member receives the message as one submitted line (`core.session.submit`); its turn ends when the program state of its session goes `working` and then `idle`, and its answer is the screen that `core.session.read` reports after the turn.

## Mentions

A mention is `@` followed by the name or the identifier of a member, compared without case, at the start of the message or after a space, and ending at a space, at a punctuation mark other than `-`, `_` and `.`, or at the end of the message; a `.` at the end of a mention is not part of it. A mention of no member is text. When the message mentions members, only the mentioned members receive it, in the order of their first mention, whatever the mode.

## Modes

The mode of the room (`facil`, `turn`, `simul`) decides who receives a message without a mention and in which order:

- `turn`: each member, one after another in roster order. The next member receives the message after the turn of the previous member has ended.
- `facil`: one member, the first member in roster order whose session is `idle`. When no member is `idle`, the send is refused with `no member is idle`. Mentioned members receive the message one after another.
- `simul`: each member at the same time. The room submits the message to every member before any turn ends, and resolves when every turn has ended; the answers keep roster order (or mention order).

A failed turn rejects the relay with the member and the reason. In `turn` and `facil` the members after it receive nothing; in `simul` the other turns run to their end, and the relay rejects with the first failure in member order.
