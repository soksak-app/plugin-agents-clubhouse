# Room relay

[English](room.md)

방은 입력창의 메시지를 owned session이 열린 체크된 member에게 전달한다. Member는 메시지를 submit된 한 줄(`core.session.submit`)로 받는다. 그 session의 program 상태가 `working`이 된 뒤 `idle`이 되면 turn이 끝나고, turn 뒤 `core.session.read`가 보고하는 화면이 답이다.

## Mention

Mention은 `@` 뒤의 member 이름이나 identifier이며 대소문자를 구분하지 않고 비교한다. 메시지의 시작이나 공백 뒤에서 시작하고, 공백, `-`, `_`, `.`이 아닌 문장 부호, 또는 메시지의 끝에서 끝난다. Mention 끝의 `.`은 mention에 속하지 않는다. 어떤 member도 가리키지 않는 mention은 text다. 메시지가 member를 mention하면 mode와 관계없이 mention된 member만 처음 mention된 순서대로 메시지를 받는다.

## Mode

방의 mode(`facil`, `turn`, `simul`)는 mention이 없는 메시지를 누가 어떤 순서로 받는지 정한다.

- `turn`: 모든 member가 roster 순서로 차례로 받는다. 앞 member의 turn이 끝난 뒤 다음 member가 받는다.
- `facil`: member 하나, 즉 roster 순서에서 session이 `idle`인 첫 member가 받는다. `idle`인 member가 없으면 send는 `no member is idle`로 거부된다. Mention된 member들은 차례로 받는다.
- `simul`: 모든 member가 동시에 받는다. 방은 어떤 turn이 끝나기 전에 모든 member에게 submit하고, 모든 turn이 끝나면 resolve한다. 답은 roster 순서(또는 mention 순서)를 지킨다.

실패한 turn은 member와 이유로 relay를 reject한다. `turn`과 `facil`에서는 그 뒤의 member가 아무것도 받지 않는다. `simul`에서는 다른 turn이 끝까지 진행되고, relay는 member 순서로 첫 실패로 reject한다.

## 공유 기록

Mention이 메시지를 받는 member를 좁혔고 mention된 모든 member가 답하면, 방은 그 대화 기록을 session이 열린 나머지 member마다 roster 순서로 submit한다. Text는 다음과 같다.

`답은 하지말고 알고있어. [@<sender>]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` 뒤에 기록이 줄마다 하나씩 온다. `@<sender>: <message>`, 그다음 mention 순서로 mention된 member마다 `@<member>: <answer>`. `<sender>`는 대화가 사람에게 보여 주는 이름(`나` 또는 `You`)이고, answer는 대화가 그 member에 대해 보여 주는 text다.

`core.session.submit`은 CR과 LF를 거부하므로, 방은 text의 각 줄 바꿈 자리를 ` | `로 잇고, 메시지나 답 안의 줄 바꿈은 공백으로 바꾼다.

방은 이 member들의 turn을 기다리지 않고 그 출력을 보여 주지 않는다. Session이 `idle`이 아닌 member는 기록을 받지 않는다. 방은 `error: room record: member <id> is <state>: record not sent`를 보고하고(session이 상태를 보고하지 않으면 `<state>`는 `without a program state`다), 거부된 submit은 그 이유와 함께 보고한다.
