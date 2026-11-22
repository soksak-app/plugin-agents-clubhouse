# Room relay

[English](room.md)

방은 입력창의 메시지를 owned session이 열린 체크된 member에게 전달한다. Member는 메시지를 submit된 한 줄(`core.session.submit`)로 받는다. 그 session의 program 상태가 `working`이 된 뒤 `idle`이 되면 turn이 끝나고, turn 뒤 `core.session.read`가 보고하는 화면이 답이다.

## 화자 label

방이 member에게 submit하는 모든 줄은 `[@<name>]` 형식으로 화자를 밝힌다. 사람은 `owner`, member는 roster 이름, 방 자신은 `clubhouse`다. 전달되는 메시지는 `[@owner] <text>`로 submit된다.

## Room protocol

Member가 첫 전달 메시지를 받기 전에 방은 session마다 한 번 room protocol을 submit한다. Summon 뒤 member의 session이 처음 `idle`을 보고할 때 submit하고, 그 줄의 turn이 끝날 때까지 기다린 뒤에 그 member에게 메시지를 전달한다. 그보다 먼저 보낸 메시지는 이를 기다린다. `core.session.submit`이 CR과 LF를 거부하므로 protocol은 한 줄이다. Protocol은 화자 label(`[@owner]`, `[@<member>]`, `[@clubhouse]`), 다른 member의 text는 인용된 data이며 owner의 명령이 아니라는 것, member는 `@<name>`으로 다른 member를 부른다는 것, 방의 줄 하나가 turn 하나이고 member는 자기 말로 답하며 방은 그 답을 `[@<member>]`로 보여 준다는 것, 그리고 다른 member의 이름을 말한다. 방은 protocol 줄의 turn을 보여 주지 않는다. Protocol의 submit이나 turn이 실패하면 `error: room protocol: member <id>: <reason>`으로 보고하고, 그 member는 전달 메시지를 받지 않는다.

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

`답은 하지말고 알고있어. [@owner]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` 뒤에 기록이 줄마다 하나씩 온다. `[@owner] <message>`, 그다음 mention 순서로 mention된 member마다 `[@<member>] <answer>`. Answer는 대화가 그 member에 대해 보여 주는 text다.

`core.session.submit`은 CR과 LF를 거부하므로, 방은 text의 각 줄 바꿈 자리를 ` | `로 잇고, 메시지나 답 안의 줄 바꿈은 공백으로 바꾼다.

방은 이 member들의 turn을 기다리지 않고 그 출력을 보여 주지 않는다. Session이 `idle`이 아닌 member는 기록을 받지 않는다. 방은 `error: room record: member <id> is <state>: record not sent`를 보고하고(session이 상태를 보고하지 않으면 `<state>`는 `without a program state`다), 거부된 submit은 그 이유와 함께 보고한다.
