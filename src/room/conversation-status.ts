// The conversation status of the room (docs/spec/room.md#conversation-status): the entries {speaker, text} of the room record that
// the page shows. The room calls changed after each change of the record, and each subscriber receives the new value.

export interface ConversationEntry {
  // `owner` or the identifier of a member.
  speaker: string;
  text: string;
}

export interface ConversationValue {
  entries: ConversationEntry[];
}

export interface ConversationStatus {
  read(): ConversationValue;
  subscribe(listener: (value: ConversationValue) => void): () => void;
  changed(): void;
}

export function createConversationStatus(lines: readonly ConversationEntry[]): ConversationStatus {
  const listeners = new Set<(value: ConversationValue) => void>();
  const read = (): ConversationValue => ({ entries: lines.map((line) => ({ speaker: line.speaker, text: line.text })) });
  return {
    read,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    changed() {
      const value = read();
      for (const listener of [...listeners]) listener(value);
    },
  };
}
