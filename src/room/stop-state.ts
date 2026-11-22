// The state of the stop button (docs/spec/room.md#commands): enabled only while a relay or a record wait runs, otherwise disabled.
// `changed` runs after each change, so the view status carries the state.
export interface StopState {
  // Sets the button from whether a relay runs and whether a record wait is open.
  update(relaying: boolean, recordWaits: boolean): void;
  enabled(): boolean;
}

export function createStopState(button: { disabled: boolean }, changed: () => void): StopState {
  return {
    update(relaying, recordWaits) {
      const disabled = !relaying && !recordWaits;
      if (button.disabled === disabled) return;
      button.disabled = disabled;
      changed();
    },
    enabled: () => !button.disabled,
  };
}
